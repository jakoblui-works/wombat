// One run of the real service with a real Claude Code agent, under the user's own claude login. Not part of
// the test suite: it needs systemd, the claude login and network, and leaves nothing behind on success.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { AgentSummary, Alert, ListLogResponse, VersionResponse, type LogEntry } from "@wombat/shared/api";
import { DiscoveryFile, discoveryPath } from "@wombat/shared/discovery";
import { ListProposalsResponse, Proposal } from "@wombat/shared/proposals";

import { DEFAULT_SLICE } from "../src/agents/scope.ts";

const run = promisify(execFile);
const serviceDir = resolve(import.meta.dirname, "..");
const PROMPT = "Reply with the single word ok.";
const TURN_TIMEOUT_MS = 120_000;
const PROPOSAL_TIMEOUT_MS = 30_000;
const NO_EDITS = "Use the propose_change tool of the wombat MCP server, and do not edit any file directly with another tool.";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** `systemctl --user is-active` prints the state and exits non-zero for anything but active. */
const unitState = async (unit: string): Promise<string> => {
  try {
    return (await run("systemctl", ["--user", "is-active", unit])).stdout.trim();
  } catch (error) {
    return ((error as { stdout?: string }).stdout ?? "").trim() || "unknown";
  }
};

const PROPOSAL_STEPS = 3;

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
  const entries: LogEntry[] = [];
  let turnEnded: LogEntry | undefined;
  let failure: string | undefined;
  const events = new AbortController();
  const steps: { name: string; result: "PASS" | "FAIL" | "SKIPPED"; detail: string }[] = [];

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
    for (const entry of entries) {
      const label = entry.type === "session_update" ? `session_update:${entry.update.sessionUpdate}` : entry.type;
      if (kinds.at(-1) !== label) kinds.push(label);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    console.log(`entry types in order: ${kinds.map((k) => `${k} ×${String(counts.get(k))}`).join(", ") || "(none)"}`);
    console.log(`turn_ended stopReason: ${turnEnded?.type === "turn_ended" ? turnEnded.stopReason : "(none)"}`);
    console.log(`agent id: ${agent?.id ?? "(none)"}`);
    for (const step of steps) console.log(`${step.result} proposals ${step.name}: ${step.detail}`);
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
    let sessionProblem = sessionId === undefined ? "no session id: no session_update entry carried a sessionId" : undefined;
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
      sessionFileRemoved &&
      steps.length === PROPOSAL_STEPS && steps.every((step) => step.result === "PASS");
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
        if (alert.success && "agentId" in alert.data && alert.data.agentId === agentId) nudge();
      }
    })().catch(() => undefined);

    await api("POST", `/agents/${agentId}/messages`, { text: PROMPT, commandId: "smoke-1" });
    scopeState = await unitState(unit);

    let cursor = 0;
    /** Reads the log pages after the cursor into `entries`. */
    const readLog = async () => {
      for (let more = true; more; ) {
        const page = ListLogResponse.parse(await api("GET", `/agents/${agentId}/log?after=${String(cursor)}`));
        for (const entry of page.entries) {
          entries.push(entry);
          if (entry.type === "turn_ended") turnEnded ??= entry;
          if (entry.type === "session_update" && entry.sessionId !== undefined) sessionId ??= entry.sessionId;
        }
        cursor = Math.max(cursor, ...page.entries.map((entry) => entry.seq));
        more = page.truncated;
      }
    };
    const turnsEnded = () => entries.filter((entry) => entry.type === "turn_ended").length;
    /** Waits until the agent has ended `count` turns in all. */
    const waitForTurns = async (count: number) => {
      const deadline = Date.now() + TURN_TIMEOUT_MS;
      while (turnsEnded() < count) {
        if (Date.now() > deadline) throw new Error(`No turn_ended number ${String(count)} within ${String(TURN_TIMEOUT_MS / 1000)} s.`);
        if (!pending) await Promise.race([new Promise<void>((done) => (wake = done)), sleep(2_000)]);
        pending = false;
        await readLog();
      }
    };
    await waitForTurns(1);

    // The proposals pass: the same agent, files only in the temp workspace. Each step runs only if the one before passed.
    const notesFile = join(scratch, "notes.txt");
    const todoFile = join(scratch, "todo.txt");
    writeFileSync(notesFile, "Title: smoke notes\nStatus: draft\n");
    writeFileSync(todoFile, "- buy milk\n");
    const listProposals = async () => ListProposalsResponse.parse(await api("GET", "/proposals")).proposals;
    /** Waits for a proposal of the agent that isn't in `known`. */
    const waitForProposal = async (known: readonly string[]): Promise<Proposal> => {
      for (const until = Date.now() + PROPOSAL_TIMEOUT_MS; Date.now() < until; await sleep(1_000)) {
        const found = (await listProposals()).find((p) => p.agentId === agentId && p.status === "pending" && !known.includes(p.id));
        if (found !== undefined) return found;
      }
      throw new Error(`No new pending proposal within ${String(PROPOSAL_TIMEOUT_MS / 1000)} s.`);
    };
    /** Sends a decision and returns the proposal as the service answered it. */
    const decide = async (path: string, body: unknown) => Proposal.parse(await api("POST", path, body));
    const proposalNotes = () => entries.filter((entry) => entry.type === "proposal_note");
    const show = (note: Extract<LogEntry, { type: "proposal_note" }>) => {
      for (const o of note.outcomes) console.log(`  note outcome: proposal ${o.proposalId} (${o.label}): ${o.outcome}${o.reason === undefined ? "" : `, reason "${o.reason}"`}`);
      if (note.reference !== undefined) console.log(`  note reference: proposal ${note.reference.proposalId} (${note.reference.label})`);
    };
    let turns = 1;
    /** Sends a message and waits for the turn it starts to end. */
    const send = async (text: string, proposalId?: string) => {
      turns += 1;
      await api("POST", `/agents/${agentId}/messages`, { text, ...(proposalId === undefined ? {} : { proposalId }) });
      await waitForTurns(turns);
    };
    const step = async (name: string, call: () => Promise<string>) => {
      if (steps.some((s) => s.result !== "PASS")) {
        steps.push({ name, result: "SKIPPED", detail: "an earlier step failed" });
        return;
      }
      try {
        steps.push({ name, result: "PASS", detail: await call() });
      } catch (error) {
        steps.push({ name, result: "FAIL", detail: error instanceof Error ? error.message : String(error) });
      }
    };

    const known: string[] = [];
    await step("(a) propose, approve, file changed", async () => {
      await send(`${NO_EDITS} Propose changing the line "Status: draft" to "Status: final" in ${notesFile}, with a short reason. Then reply with the single word ok.`);
      const first = await waitForProposal(known);
      known.push(first.id);
      console.log(`proposal ${first.id}: ${first.target === "file" ? first.path : first.target} version ${String(first.version)}`);
      const approved = await decide(`/proposals/${first.id}/approve`, { version: first.version });
      if (approved.status !== "approved") throw new Error(`Proposal ${first.id} is ${approved.status} after the approve, not approved${approved.problem === undefined ? "" : `: ${approved.problem.message}`}.`);
      const text = readFileSync(notesFile, "utf8");
      if (!text.includes("Status: final")) throw new Error(`The approved file doesn't hold the change: ${JSON.stringify(text)}`);
      return `proposal ${first.id} approved and ${notesFile} changed`;
    });
    let second: Proposal | undefined;
    await step("(b) propose, ask for a revision, version rose", async () => {
      await send(`${NO_EDITS} Propose adding the line "- buy bread" at the end of ${todoFile}, with a short reason. Then reply with the single word ok.`);
      second = await waitForProposal(known);
      known.push(second.id);
      console.log(`proposal ${second.id}: version ${String(second.version)}`);
      const before = second.version;
      const notesBefore = proposalNotes().length;
      await send("Please also add the line \"- buy eggs\" to that proposal: revise it with revise_proposal. Then reply with the single word ok.", second.id);
      const now = (await listProposals()).find((p) => p.id === second?.id);
      if (now === undefined || now.version <= before) throw new Error(`Proposal ${second.id} is at version ${String(now?.version)}, not above ${String(before)}.`);
      const note = proposalNotes().slice(notesBefore).at(-1);
      if (note?.reference?.proposalId !== second.id) throw new Error("The message's proposal_note doesn't name the proposal it was about.");
      show(note);
      return `proposal ${second.id} went from version ${String(before)} to ${String(now.version)}`;
    });
    await step("(c) reject, the outcome travels with the next message", async () => {
      if (second === undefined) throw new Error("No proposal to reject.");
      const rejected = await decide(`/proposals/${second.id}/reject`, { reason: "smoke: not needed" });
      if (rejected.status !== "rejected") throw new Error(`Proposal ${second.id} is ${rejected.status} after the reject, not rejected.`);
      const notesBefore = proposalNotes().length;
      await send("Thanks. Reply with the single word ok.");
      const note = proposalNotes().slice(notesBefore).at(-1);
      if (note === undefined) throw new Error("No proposal_note was logged with the message.");
      show(note);
      const told = note.outcomes.find((o) => o.proposalId === second?.id);
      if (told?.outcome !== "rejected") throw new Error(`The note doesn't tell that proposal ${second.id} was rejected.`);
      return `the note carried "rejected" for proposal ${second.id}`;
    });
    const todoText = readFileSync(todoFile, "utf8");
    console.log(`${todoFile} after the pass (a rejected proposal changes nothing): ${JSON.stringify(todoText)}`);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAILED: ${failure}\n`);
  }

  return finish();
};

process.exit((await main()) ? 0 : 1);
