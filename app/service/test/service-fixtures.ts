// The service as a process, for checks that need its whole start-up wiring (the instructions file): a temp
// workspace with one repo and, optionally, an items root inside it; the real `main()` through
// instructions-entry.ts, with recording fakes of systemd as its whole PATH; and the calls a test makes as the app
// (with the discovery file's token) and as an agent (with the token from the agent's own MCP config).
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiscoveryFile } from "@wombat/shared/discovery";
import { expect, onTestFinished } from "vitest";

import { fakeSystemd } from "./fake-systemd.ts";
import { writeAt } from "./items-fixtures.ts";
import { REPO, SERVICE_SLICE, WAIT_MS, waitFor } from "./manager-fixtures.ts";
import { APP_ORIGIN, rawRequest, type Response } from "./server-fixtures.ts";

const SERVICE_DIR = join(import.meta.dirname, "..");
const ENTRY = join(import.meta.dirname, "instructions-entry.ts");

/** The harness ids instructions-entry.ts registers. */
export const PROMPTED = "fake-prompted";
export const PLAIN = "fake-plain";

/** Where the items root sits in the test workspace: a docs repo of its own, beside the agents' repo. */
export const ITEMS_DIR = join("platform-docs", "items");

export type RunningService = {
  workspace: string;
  /** Undefined when the service runs without WOMBAT_ITEMS. */
  itemsRoot: string | undefined;
  /** `<workspace>/.wombat/AGENTS.md` */
  instructionsPath: string;
  file: DiscoveryFile;
  stderr: () => string;
  /** A call as the app, with the service's token. */
  api: (method: string, path: string, body?: unknown) => Promise<Response>;
};

export type ServiceOptions = {
  /** Item files written under the items root before start; undefined runs the service without WOMBAT_ITEMS. */
  items?: Record<string, string>;
  /** Files written relative to the workspace before start (a stale instructions file, say). */
  workspaceFiles?: Record<string, string>;
  /** The script that runs `main()`; default instructions-entry.ts. */
  entry?: string;
  /** More variables for the service's environment. */
  env?: NodeJS.ProcessEnv;
};

/** Starts the service on a fresh workspace and waits for its discovery file; everything is stopped afterwards. */
export const startService = async ({ items, workspaceFiles = {}, entry = ENTRY, env: extraEnv = {} }: ServiceOptions = {}): Promise<RunningService> => {
  const base = mkdtempSync(join(tmpdir(), "wombat-instructions-"));
  const workspace = join(base, "workspace");
  const runtimeDir = join(base, "run");
  const pidDir = join(base, "pids");
  const home = join(base, "home");
  mkdirSync(join(workspace, REPO), { recursive: true });
  mkdirSync(runtimeDir, { mode: 0o700 });
  mkdirSync(pidDir);
  mkdirSync(home);
  const itemsRoot = items === undefined ? undefined : join(workspace, ITEMS_DIR);
  if (itemsRoot !== undefined) {
    mkdirSync(itemsRoot, { recursive: true });
    for (const [path, text] of Object.entries(items ?? {})) writeAt(itemsRoot, path, text);
  }
  for (const [path, text] of Object.entries(workspaceFiles)) writeAt(workspace, path, text);

  const systemd = fakeSystemd();
  const slice = `wombattest${randomUUID().replaceAll("-", "")}.slice`;
  const discoveryPath = join(runtimeDir, "wombat", "service.json");
  const env: NodeJS.ProcessEnv = {
    PATH: systemd.binDir,
    HOME: home,
    XDG_RUNTIME_DIR: runtimeDir,
    WOMBAT_WORKSPACE: workspace,
    WOMBAT_STORE: join(base, "state", "service.db"),
    WOMBAT_PORT: "0",
    FAKE_AGENT_PID_DIR: pidDir,
    WOMBAT_TEST_SLICE: slice,
    ...(itemsRoot === undefined ? {} : { WOMBAT_ITEMS: itemsRoot }),
    ...extraEnv,
  };
  const child: ChildProcess = spawn(process.execPath, [entry], { cwd: SERVICE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout?.resume();
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const pid of readdirSync(pidDir).map(Number)) {
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    const touched = systemd.calls().filter(({ args }) => args.some((arg) => arg.includes(SERVICE_SLICE)));
    systemd.remove();
    rmSync(base, { recursive: true, force: true });
    if (touched.length > 0) throw new Error(`a service under test touched the real slice: ${JSON.stringify(touched)}`);
  });

  const deadline = Date.now() + WAIT_MS;
  while (!existsSync(discoveryPath)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the service exited before writing the discovery file; stderr:\n${stderr}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for the discovery file; stderr:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const file = DiscoveryFile.parse(JSON.parse(readFileSync(discoveryPath, "utf8")));
  return {
    workspace,
    itemsRoot,
    instructionsPath: join(workspace, ".wombat", "AGENTS.md"),
    file,
    stderr: () => stderr,
    api: (method, path, body) =>
      rawRequest(file.port, { method, path, body, headers: { authorization: `Bearer ${file.token}`, origin: APP_ORIGIN } }),
  };
};

export type RecordedAgent = {
  agentId: string;
  /** The raw params of the agent's session/new, as they came over the wire. */
  sessionNew: Record<string, unknown>;
  /** The bearer token from the agent's wombat MCP entry. */
  token: string;
};

/** Starts an agent on `harness` and returns what its session/new carried (the mcp-config scenario reports it). */
export const startRecorded = async (service: RunningService, harness: string): Promise<RecordedAgent> => {
  const started = await service.api("POST", "/agents", { harness, repo: REPO });
  expect(started.status, `start ${harness}: ${started.text}`).toBe(201);
  const agentId = (started.json as { id: string }).id;
  const dir = mkdtempSync(join(tmpdir(), "wombat-recorded-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const report = join(dir, "config.json");
  const sent = await service.api("POST", `/agents/${agentId}/messages`, { text: report });
  expect(sent.status, `send to ${harness}: ${sent.text}`).toBe(202);
  await waitFor(`${harness}'s report`, () => existsSync(report) && readFileSync(report, "utf8").length > 0);
  const reported = JSON.parse(readFileSync(report, "utf8")) as {
    sessionNew?: Record<string, unknown>;
    mcpServers?: { name?: string; headers?: { name: string; value: string }[] }[];
  };
  const header = reported.mcpServers
    ?.find((entry) => entry.name === "wombat")
    ?.headers?.find((candidate) => candidate.name.toLowerCase() === "authorization")?.value;
  expect(reported.sessionNew, `${harness}: the fake agent recorded its session/new`).toBeDefined();
  return { agentId, sessionNew: reported.sessionNew ?? {}, token: (header ?? "").replace(/^Bearer /, "") };
};

/** The text a recorded session/new's `systemPrompt` carries, its text blocks joined as claude-agent-acp joins them. */
export const promptText = (sessionNew: Record<string, unknown>): string | undefined => {
  const prompt = sessionNew.systemPrompt as { mode?: unknown; content?: { type: string; text?: string }[] } | undefined;
  return prompt?.content?.map((block) => block.text ?? "").join("\n\n");
};

/** Calls a tool on /mcp as an agent; returns the tool's JSON answer (fails the test on a tool error). */
export const agentTool = async (service: RunningService, token: string, name: string, args: Record<string, unknown>): Promise<unknown> => {
  const response = await rawRequest(service.file.port, {
    method: "POST",
    path: "/mcp",
    headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status, `${name}: ${response.text}`).toBe(200);
  const result = (response.json as { result?: { isError?: boolean; content?: { text?: string }[] } }).result;
  const text = result?.content?.[0]?.text ?? "";
  expect(result?.isError, `${name}: ${text}`).not.toBe(true);
  return JSON.parse(text) as unknown;
};

/** The instructions file's text, or undefined when there is none. */
export const readInstructions = (service: RunningService) =>
  existsSync(service.instructionsPath) ? readFileSync(service.instructionsPath, "utf8") : undefined;
