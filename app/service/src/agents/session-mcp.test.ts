// What session/new carries: the Claude Code harness's pre-allowed Wombat tools (D16) as `_meta`, and no `_meta`
// from a harness that sets none. S2d (T19-2): session/resume carries the same session params as session/new.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { fakeHarness } from "../../test/fake-harness.ts";
import { TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { claudeCode } from "../harness/claude-code.ts";
import type { Harness } from "../harness/harness.ts";
import { startServer } from "../server/server.ts";
import { openStore } from "../store/store.ts";
import { createManager } from "./manager.ts";

const SDK = import.meta.resolve("@agentclientprotocol/sdk");

/** An ACP agent that writes its session/new params to the file in RECORD_TO. */
const RECORDER = `
import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { agent, ndJsonStream } from ${JSON.stringify(SDK)};
agent({ name: "recorder" })
  .onRequest("initialize", () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
  .onRequest("session/new", ({ params }) => {
    writeFileSync(process.env.RECORD_TO, JSON.stringify(params));
    return { sessionId: "session-1" };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`;

type SessionNew = {
  mcpServers: { type: string; name: string; url: string; headers: { name: string; value: string }[] }[];
  _meta?: unknown;
};

const recorder = (id: string, file: string, sessionMeta?: Record<string, unknown>): Harness => ({
  id,
  name: id,
  loginHint: "No login.",
  spawn: (cwd) => ({
    command: process.execPath,
    args: ["--input-type=module", "--eval", RECORDER],
    cwd,
    env: { PATH: process.env.PATH ?? "", RECORD_TO: file },
  }),
  ...(sessionMeta === undefined ? {} : { sessionMeta }),
});

/** A manager and server on a fresh store, with a recorder harness with and one without `_meta`. */
const start = async () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-session-mcp-"));
  const workspace = join(base, "workspace");
  mkdirSync(join(workspace, "repo"), { recursive: true });
  mkdirSync(join(base, "bin"));
  const store = openStore({ path: join(base, "service.db") });
  const files = { claude: join(base, "claude.json"), plain: join(base, "plain.json") };
  const harnesses = [recorder("with-meta", files.claude, claudeCode.sessionMeta), recorder("plain", files.plain)];
  const manager = createManager({
    store,
    workspaceRoot: workspace,
    harnesses,
    log: () => undefined,
    // No systemd: the agents run without a scope.
    env: { ...process.env, PATH: join(base, "bin") },
    readInstructions: () => Promise.resolve(undefined),
    slice: `wombattest${randomUUID().replaceAll("-", "")}.slice`,
  });
  const server = await startServer({ manager, store, harnesses, workspaceRoot: workspace, token: randomBytes(24).toString("base64url"), log: () => undefined });
  onTestFinished(async () => {
    await server.close();
    await manager.shutdown();
    store.close();
    rmSync(base, { recursive: true, force: true });
  });
  const read = (which: keyof typeof files) => JSON.parse(readFileSync(files[which], "utf8")) as SessionNew;
  return { manager, read };
};

describe("session/new", () => {
  test(
    "carries the Claude Code harness's pre-allowed Wombat tools, and no _meta for a harness without any",
    async () => {
      const { manager, read } = await start();

      await manager.start("with-meta", "repo");
      await manager.start("plain", "repo");

      expect(read("claude")._meta).toEqual({
        claudeCode: { options: { allowedTools: ["mcp__wombat__*"] }, emitRawSDKMessages: [{ type: "assistant" }] },
      });
      expect(read("plain")).not.toHaveProperty("_meta");
    },
    TEST_TIMEOUT_MS,
  );
});

type Reported = {
  sessionNew?: Record<string, unknown>;
  sessionResume?: Record<string, unknown>;
  sessionId?: string;
};

const wombatUrl = (params: Record<string, unknown> | undefined) =>
  (params?.mcpServers as SessionNew["mcpServers"] | undefined)?.find((entry) => entry.name === "wombat")?.url;

/**
 * A manager and server with one resumable harness on the fake agent's mcp-config scenario that sets `_meta` and asks
 * for the instructions as Claude Code does; `instructions` is what the next read of them returns.
 */
const startResumable = async () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-session-resume-"));
  const workspace = join(base, "workspace");
  mkdirSync(join(workspace, "repo"), { recursive: true });
  mkdirSync(join(base, "bin"));
  const store = openStore({ path: join(base, "service.db") });
  const harness: Harness = {
    ...fakeHarness("mcp-config"),
    id: "resumable-with-meta",
    ...(claudeCode.sessionMeta === undefined ? {} : { sessionMeta: claudeCode.sessionMeta }),
    ...(claudeCode.sessionParams === undefined ? {} : { sessionParams: claudeCode.sessionParams }),
  };
  const instructions = { now: "Bakery site: keep the opening hours in one place." };
  const manager = createManager({
    store,
    workspaceRoot: workspace,
    harnesses: [harness],
    log: () => undefined,
    env: { ...process.env, PATH: join(base, "bin") },
    readInstructions: () => Promise.resolve(instructions.now),
    slice: `wombattest${randomUUID().replaceAll("-", "")}.slice`,
  });
  const server = await startServer({ manager, store, harnesses: [harness], workspaceRoot: workspace, token: randomBytes(24).toString("base64url"), log: () => undefined });
  onTestFinished(async () => {
    await server.close();
    await manager.shutdown();
    store.close();
    rmSync(base, { recursive: true, force: true });
  });
  let reports = 0;
  /** Sends the agent a report path and returns what it reported (its session params, raw from the wire). */
  const report = async (agentId: string): Promise<Reported> => {
    const ended = () => store.readLog(agentId).entries.filter((entry) => entry.type === "turn_ended").length;
    const before = ended();
    reports += 1;
    const file = join(base, `report-${String(reports)}.json`);
    await manager.send(agentId, { text: file });
    await waitFor("the report's turn to end", () => ended() > before);
    return JSON.parse(readFileSync(file, "utf8")) as Reported;
  };
  return { manager, store, harness, instructions, report };
};

describe("session/resume", () => {
  test(
    "T19-2: carries the stored session id, the same cwd, _meta and wombat /mcp server as session/new, and the instructions as they are now",
    async () => {
      const { manager, store, harness, instructions, report } = await startResumable();
      const { id } = await manager.start(harness.id, "repo");
      const started = await report(id);
      await manager.stop(id);
      instructions.now = "Bakery site: the opening hours now live in hours.md.";
      const resumed = await report(id);

      const sessionNew = started.sessionNew;
      const resume = resumed.sessionResume;
      expect(sessionNew, "control: the first process got session/new").toBeDefined();
      expect(resume, "the second process got session/resume").toBeDefined();
      expect(resumed.sessionNew, "and no session/new").toBeUndefined();
      expect(resume?.sessionId, "the stored session").toBe(store.listAgents().find((agent) => agent.id === id)?.sessionId);
      expect(resume?.sessionId).toBe(started.sessionId);
      expect(resumed.sessionId, "the prompt runs in it").toBe(started.sessionId);
      expect(resume?.cwd).toBe(sessionNew?.cwd);
      expect(resume?._meta, "the harness's _meta").toEqual(sessionNew?._meta);
      expect(sessionNew?._meta, "control: there is a _meta to carry").toBeDefined();
      expect(wombatUrl(resume), "the wombat /mcp server").toBe(wombatUrl(sessionNew));
      expect(wombatUrl(sessionNew), "control: session/new had one").toBeDefined();
      expect(resume?.systemPrompt, "the instructions read at the resume").toEqual(harness.sessionParams?.(instructions.now).systemPrompt);
    },
    TEST_TIMEOUT_MS,
  );
});
