// One run of the real service with a real Claude Code agent, under the user's own claude login. Not part of
// the test suite: it needs systemd, the claude login and network, and leaves nothing behind on success.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { AgentSummary, Alert, ListItemsResponse, VersionResponse, type Item } from "@wombat/shared/api";
import { DiscoveryFile } from "@wombat/shared/discovery";

import { DEFAULT_SLICE } from "../src/agents/scope.ts";
import { discoveryPath } from "../src/discovery.ts";

const run = promisify(execFile);
const serviceDir = resolve(import.meta.dirname, "..");
const PROMPT = "Reply with the single word ok.";
const TURN_TIMEOUT_MS = 120_000;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** `systemctl --user is-active` prints the state and exits non-zero for anything but active. */
const unitState = async (unit: string): Promise<string> => {
  try {
    return (await run("systemctl", ["--user", "is-active", unit])).stdout.trim();
  } catch (error) {
    return ((error as { stdout?: string }).stdout ?? "").trim() || "unknown";
  }
};

const refuse = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

/** Claude Code's folder name for a project: the real path with every non-alphanumeric character as "-". */
const projectFolderName = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

const exited = (child: ChildProcess) =>
  new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once("exit", () => done());
  });

const main = async (): Promise<boolean> => {
  const env = process.env;
  const discovery = discoveryPath(env);

  if ((await unitState(DEFAULT_SLICE)) === "active") {
    return refuse(
      `${DEFAULT_SLICE} is already active, so another Wombat service may own agents. Stop that service (and its agents) and run this again.`,
    );
  }

  const scratch = mkdtempSync(join(tmpdir(), "wombat-smoke-ws-"));
  const tempStore = mkdtempSync(join(tmpdir(), "wombat-smoke-store-"));
  const scratchReal = realpathSync(scratch);

  let child: ChildProcess | undefined;
  let base = "";
  let headers: Record<string, string> = {};
  let agent: AgentSummary | undefined;
  let sessionId: string | undefined;
  let scopeState = "not checked";
  const items: Item[] = [];
  let turnEnded: Item | undefined;
  let failure: string | undefined;
  const events = new AbortController();

  const api = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    // Error bodies carry code and message only, never agent content.
    if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}: ${text.slice(0, 300)}`);
    return text === "" ? undefined : JSON.parse(text);
  };

  let finishing: Promise<boolean> | undefined;
  const finish = () =>
    (finishing ??= (async (): Promise<boolean> => {
    // Report what happened before cleanup, so a cleanup problem can't hide it.
    const kinds: string[] = [];
    const counts = new Map<string, number>();
    for (const item of items) {
      const label = item.type === "session_update" ? `session_update:${item.update.sessionUpdate}` : item.type;
      if (kinds.at(-1) !== label) kinds.push(label);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    console.log(`item types in order: ${kinds.map((k) => `${k} ×${String(counts.get(k))}`).join(", ") || "(none)"}`);
    console.log(`turn_ended stopReason: ${turnEnded?.type === "turn_ended" ? turnEnded.stopReason : "(none)"}`);
    console.log(`agent id: ${agent?.id ?? "(none)"}`);
    console.log(`scope unit: ${agent ? `wombat-agent-${agent.id}.scope` : "(none)"} is-active: ${scopeState}`);

    // Cleanup: each step has its own handling so one failure never skips the rest.
    let cleanupFailed = false;
    events.abort();
    if (agent !== undefined && base !== "") {
      try {
        await api("DELETE", `/agents/${agent.id}`);
      } catch (error) {
        process.stderr.write(`cleanup: DELETE agent failed: ${(error as Error).message}\n`);
      }
    }
    if (child !== undefined) {
      try {
        child.kill("SIGTERM");
        const stopped = await Promise.race([exited(child).then(() => true), sleep(15_000).then(() => false)]);
        if (!stopped) {
          process.stderr.write("WARNING: the service didn't exit within 15 s of SIGTERM; sending SIGKILL.\n");
          child.kill("SIGKILL");
          await exited(child);
        }
      } catch (error) {
        cleanupFailed = true;
        process.stderr.write(`cleanup: stopping the service failed: ${(error as Error).message}\n`);
      }
    }
    const discoveryGone = !existsSync(discovery);
    const sliceState = await unitState(DEFAULT_SLICE);
    console.log(`discovery file gone: ${String(discoveryGone)}`);
    console.log(`${DEFAULT_SLICE} state: ${sliceState}`);

    let sessionFileRemoved = false;
    let sessionProblem = sessionId === undefined ? "no session id: no session_update item carried a sessionId" : undefined;
    try {
      const claudeDir = env.CLAUDE_CONFIG_DIR !== undefined && env.CLAUDE_CONFIG_DIR !== "" ? env.CLAUDE_CONFIG_DIR : join(homedir(), ".claude");
      const projectDir = join(claudeDir, "projects", projectFolderName(scratchReal));
      if (existsSync(projectDir)) {
        const listing = readdirSync(projectDir);
        console.log(`claude project folder ${projectDir}: ${listing.length === 0 ? "(empty)" : listing.join(", ")}`);
        const file = sessionId === undefined ? undefined : `${sessionId}.jsonl`;
        if (sessionId !== undefined && file !== undefined && listing.includes(file)) {
          rmSync(join(projectDir, file));
          sessionFileRemoved = true;
          console.log(`removed session file ${file}`);
          // The session's own folder (subagents, tool results), matched by exact name; nothing else is recursive.
          if (listing.includes(sessionId)) {
            rmSync(join(projectDir, sessionId), { recursive: true });
            console.log(`removed session folder ${sessionId}`);
          }
          const left = readdirSync(projectDir);
          if (left.length === 0) rmdirSync(projectDir);
          else console.log(`left in the project folder: ${left.join(", ")}`);
        } else if (sessionId !== undefined) {
          sessionProblem = `no ${file ?? ""} in the project folder; nothing deleted`;
        }
      } else {
        sessionProblem ??= `no claude project folder at ${projectDir}; nothing deleted`;
      }
    } catch (error) {
      cleanupFailed = true;
      sessionProblem = `session cleanup failed: ${(error as Error).message}`;
    }
    if (!sessionFileRemoved) console.log(`session file not removed: ${sessionProblem ?? "unknown reason"}`);

    for (const dir of [scratch, tempStore]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        cleanupFailed = true;
        process.stderr.write(`cleanup: removing ${dir} failed: ${(error as Error).message}\n`);
      }
    }

    const ok =
      failure === undefined &&
      !cleanupFailed &&
      (counts.get("session_update:agent_message_chunk") ?? 0) > 0 &&
      turnEnded?.type === "turn_ended" &&
      turnEnded.stopReason === "end_turn" &&
      scopeState === "active" &&
      discoveryGone &&
      sliceState !== "active" &&
      sessionFileRemoved;
    console.log(ok ? "SMOKE PASSED" : "SMOKE FAILED");
    return ok;
    })());

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      process.stderr.write(`${signal}: cleaning up before exit.\n`);
      void finish().then(() => process.exit(130));
    });
  }
  try {
    child = spawn("node", ["src/main.ts"], {
      cwd: serviceDir,
      env: { ...env, WOMBAT_WORKSPACE: scratch, WOMBAT_STORE: join(tempStore, "service.db"), WOMBAT_PORT: "0" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const service = child;
    createInterface({ input: service.stderr! }).on("line", (line) => process.stderr.write(`[service] ${line}\n`));
    let earlyExit: number | null | undefined;
    service.once("exit", (code) => (earlyExit = code));

    let file: DiscoveryFile | undefined;
    for (const deadline = Date.now() + 10_000; Date.now() < deadline && file === undefined; ) {
      if (earlyExit !== undefined) throw new Error(`The service exited (code ${String(earlyExit)}) before it was ready; see [service] lines above.`);
      if (existsSync(discovery)) {
        try {
          const found = DiscoveryFile.parse(JSON.parse(readFileSync(discovery, "utf8")));
          // A stale file from an earlier run stays until main.ts replaces it; only our child's pid counts.
          if (found.pid === service.pid) file = found;
        } catch {
          // Unreadable stale file; keep waiting.
        }
      }
      if (file === undefined) await sleep(100);
    }
    if (file === undefined) throw new Error(`No discovery file naming our service (pid ${String(service.pid)}) at ${discovery} within 10 s.`);
    base = `http://127.0.0.1:${String(file.port)}`;
    headers = { authorization: `Bearer ${file.token}` };

    const version = VersionResponse.parse(await api("GET", "/version"));
    console.log(`apiVersion: ${String(version.apiVersion)}`);

    // Subscribed before the message is sent so no alert can be missed.
    let wake: (() => void) | undefined;
    let pending = false;
    const nudge = () => {
      pending = true;
      wake?.();
    };
    const streamResponse = await fetch(`${base}/events`, { headers, signal: events.signal });
    if (!streamResponse.ok || streamResponse.body === null) throw new Error(`GET /events answered ${String(streamResponse.status)}.`);

    agent = AgentSummary.parse(await api("POST", "/agents", { harness: "claude-code", repo: "." }));
    const agentId = agent.id;
    const unit = `wombat-agent-${agentId}.scope`;

    void (async () => {
      const lines = createInterface({ input: streamResponse.body as unknown as NodeJS.ReadableStream });
      for await (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const alert = Alert.safeParse(JSON.parse(line.slice(5)));
        if (alert.success && alert.data.agentId === agentId) nudge();
      }
    })().catch(() => undefined);

    await api("POST", `/agents/${agentId}/messages`, { text: PROMPT, commandId: "smoke-1" });
    scopeState = await unitState(unit);

    let cursor = 0;
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (turnEnded === undefined) {
      if (Date.now() > deadline) throw new Error(`No turn_ended within ${String(TURN_TIMEOUT_MS / 1000)} s.`);
      if (!pending) await Promise.race([new Promise<void>((done) => (wake = done)), sleep(2_000)]);
      pending = false;
      for (let more = true; more; ) {
        const page = ListItemsResponse.parse(await api("GET", `/agents/${agentId}/items?after=${String(cursor)}`));
        for (const item of page.items) {
          items.push(item);
          if (item.type === "turn_ended") turnEnded = item;
          if (item.type === "session_update" && item.sessionId !== undefined) sessionId ??= item.sessionId;
        }
        cursor = Math.max(cursor, ...page.items.map((item) => item.seq));
        more = page.truncated;
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAILED: ${failure}\n`);
  }

  return finish();
};

process.exit((await main()) ? 0 : 1);
