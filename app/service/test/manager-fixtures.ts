// Shared setup for the agent manager tests: a temp workspace with one repo, a temp store, fake agents that
// record their pids, a capturing logger and the committed events, all torn down after the test. Each test gets
// its own systemd slice; by default the manager sees no systemd at all (an empty PATH dir).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import { onTestFinished } from "vitest";

import { createManager, type Committed } from "../src/agents/manager.ts";
import { readInstructions } from "../src/items/instructions.ts";
import type { Harness } from "../src/harness/harness.ts";
import { openStore, type Store, type StoreOptions } from "../src/store/store.ts";
import { SCENARIOS, type FakeScenario } from "./fake-agent.ts";
import { fakeHarness, type FakeHarnessOptions } from "./fake-harness.ts";
import { fakeSystemd, type FakeSystemd, type FakeSystemdOptions } from "./fake-systemd.ts";

/** Per-test timeout and how long a test waits for an agent to get somewhere, in one place. */
export const TEST_TIMEOUT_MS = 15_000;
export const WAIT_MS = 8_000;

export const REPO = "site-web";

export type Manager = ReturnType<typeof createManager>;
export type LogLine = { event: string; fields: Record<string, string | number | boolean> };
export type { Committed };

const RECORD_PID = pathToFileURL(join(import.meta.dirname, "record-pid.ts")).href;

/** The fake agent on `scenario`, with id `fake-<scenario>`, recording its pid in `pidDir`. */
export const trackedHarness = (scenario: FakeScenario, pidDir: string, options: FakeHarnessOptions = {}): Harness => {
  const fake = fakeHarness(scenario, options);
  return {
    ...fake,
    id: `fake-${scenario}`,
    spawn: (cwd, source) => {
      const spec = fake.spawn(cwd, source);
      return { ...spec, args: ["--import", RECORD_PID, ...spec.args], env: { ...spec.env, FAKE_AGENT_PID_DIR: pidDir } };
    },
  };
};

export const ALL_SCENARIOS: readonly FakeScenario[] = SCENARIOS;

/** A harness on the reply scenario that doesn't offer the context breakdown (no `contextBreakdown`). */
export const NO_CONTEXT_HARNESS = "fake-reply-no-context";

/** A harness on the reply scenario that can't resume its agents (no `resumable`; S2d, D28). */
export const NO_RESUME_HARNESS = "fake-reply-no-resume";

/**
 * A harness on the hang scenario whose `contextBreakdown` gives up after CONTEXT_GIVE_UP_MS, while the agent still
 * holds the `/context` prompt (until a release file or a cancel; see CONTEXT_CANCELLED_FILE).
 */
export const GIVE_UP_HARNESS = "fake-hang-gives-up";
export const CONTEXT_GIVE_UP_MS = 300;

/**
 * Every harness the fixtures give the manager: each scenario as `fake-<scenario>`, NO_CONTEXT_HARNESS,
 * GIVE_UP_HARNESS and NO_RESUME_HARNESS.
 */
export const fixtureHarnesses = (pidDir: string): Harness[] => [
  ...ALL_SCENARIOS.map((scenario) => trackedHarness(scenario, pidDir)),
  { ...trackedHarness("reply", pidDir, { context: false }), id: NO_CONTEXT_HARNESS },
  { ...trackedHarness("hang", pidDir, { contextTimeoutMs: CONTEXT_GIVE_UP_MS }), id: GIVE_UP_HARNESS },
  { ...trackedHarness("reply", pidDir, { resume: false }), id: NO_RESUME_HARNESS },
];

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const groupAlive = (pgid: number) => isAlive(-pgid);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it's true; fails with `what` after WAIT_MS. */
export const waitFor = async (what: string, check: () => boolean) => {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
};

/** The error a sync call throws (or undefined). */
export const thrown = (call: () => unknown): unknown => {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** The slice the real service uses; no test may ever touch it. */
export const SERVICE_SLICE = "wombat-agents.slice";

export type SetupOptions = {
  /**
   * "none" (default): no systemd-run or systemctl on the manager's PATH. "fake": the recording fakes from
   * fake-systemd.ts, configured by `fake`. "real": the service's own environment, so the real user manager.
   */
  systemd?: "none" | "fake" | "real";
  fake?: FakeSystemdOptions;
  /** Passed to every openStore of this setup (the cap, for example). */
  storeOptions?: Omit<StoreOptions, "path">;
  /** How long a config set waits for the agent (the manager's default when absent). */
  configSetTimeoutMs?: number;
};

export type Setup = {
  manager: Manager;
  /**
   * This test's own slice, `wombattest<uuid without dashes>.slice`, passed to the manager. Dash-free: systemd
   * nests slices on every `-`, so this one sits directly under -.slice and stopping it leaves no parents behind.
   */
  slice: string;
  /** The fakes, when `systemd` is "fake". */
  systemd: FakeSystemd | undefined;
  store: Store;
  storePath: string;
  root: string;
  pidDir: string;
  logs: LogLine[];
  committed: Committed[];
  /** Pids of every agent process started so far. */
  pids: () => number[];
  entries: (agentId: string) => LogEntry[];
  agent: (agentId: string) => AgentSummary | undefined;
  /** Waits until the agent has `count` turn_ended entries (default 1), and returns the `count`th. */
  turnEnded: (agentId: string, count?: number) => Promise<Extract<LogEntry, { type: "turn_ended" }>>;
  /** Shuts the manager down, reopens the store and creates a new manager on it (a service restart). */
  restart: () => Promise<void>;
};

const killAll = (pids: number[]) => {
  for (const pid of pids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
};

/** A manager on a fresh store and workspace, with every fake scenario available as `fake-<scenario>`. */
export const setup = ({ systemd = "none", fake, storeOptions = {}, configSetTimeoutMs }: SetupOptions = {}): Setup => {
  const base = mkdtempSync(join(tmpdir(), "wombat-manager-"));
  const slice = `wombattest${randomUUID().replaceAll("-", "")}.slice`;
  const emptyBin = join(base, "empty-bin");
  mkdirSync(emptyBin);
  const fakes = systemd === "fake" ? fakeSystemd(fake) : undefined;
  const env: NodeJS.ProcessEnv =
    systemd === "real" ? process.env : { ...process.env, PATH: fakes ? fakes.binDir : emptyBin };
  const root = join(base, "workspace");
  mkdirSync(join(root, REPO), { recursive: true });
  const pidDir = join(base, "pids");
  mkdirSync(pidDir);
  const storePath = join(base, "state", "wombat", "service.db");
  const harnesses = fixtureHarnesses(pidDir);
  const logs: LogLine[] = [];
  const committed: Committed[] = [];

  const make = (store: Store) => {
    const manager = createManager({
      store,
      workspaceRoot: root,
      harnesses,
      log: (event: string, fields: LogLine["fields"]) => logs.push({ event, fields }),
      env,
      slice,
      readInstructions: () => readInstructions(root),
      ...(configSetTimeoutMs === undefined ? {} : { configSetTimeoutMs }),
    });
    manager.onCommitted((event: Committed) => committed.push(event));
    return manager;
  };

  const pids = () => readdirSync(pidDir).map(Number);
  const state = { store: undefined as Store | undefined, manager: undefined as Manager | undefined };

  // Registered first, so a failing open or create still cleans up.
  onTestFinished(async () => {
    try {
      await state.manager?.shutdown();
    } catch {
      // Shut down by the test, or broken: the kill below covers it.
    }
    killAll(pids());
    if (systemd === "real") spawnSync("systemctl", ["--user", "stop", slice], { stdio: "ignore", timeout: 10_000 });
    const touched = fakes?.calls().filter(({ args }) => args.some((arg) => arg.includes(SERVICE_SLICE))) ?? [];
    fakes?.remove();
    try {
      state.store?.close();
    } catch {
      // Already closed.
    }
    rmSync(base, { recursive: true, force: true });
    if (touched.length > 0) throw new Error(`a test touched the service's own slice: ${JSON.stringify(touched)}`);
  });
  state.store = openStore({ ...storeOptions, path: storePath });
  state.manager = make(state.store);

  const setupObject: Setup = {
    get manager() {
      if (!state.manager) throw new Error("no manager");
      return state.manager;
    },
    get store() {
      if (!state.store) throw new Error("no store");
      return state.store;
    },
    slice,
    systemd: fakes,
    storePath,
    root,
    pidDir,
    logs,
    committed,
    pids,
    entries: (agentId) => setupObject.store.readLog(agentId).entries,
    agent: (agentId) => setupObject.store.listAgents().find((agent) => agent.id === agentId),
    turnEnded: async (agentId, count = 1) => {
      let ended: Extract<LogEntry, { type: "turn_ended" }>[] = [];
      await waitFor(`turn ${count} of ${agentId} to end`, () => {
        ended = setupObject.entries(agentId).filter((entry) => entry.type === "turn_ended");
        return ended.length >= count;
      });
      const turn = ended[count - 1];
      if (!turn) throw new Error("no turn_ended");
      return turn;
    },
    restart: async () => {
      await state.manager?.shutdown();
      state.store?.close();
      state.store = openStore({ ...storeOptions, path: storePath });
      state.manager = make(state.store);
    },
  };
  return setupObject;
};

/** Text of the agent_message_chunk entries, in order. */
export const chunkTexts = (entries: LogEntry[]) =>
  entries.flatMap((entry) =>
    entry.type === "session_update" &&
    entry.update.sessionUpdate === "agent_message_chunk" &&
    entry.update.content.type === "text"
      ? [entry.update.content.text]
      : [],
  );

/** The pid of the child the spawn-child scenario started, from its `{"childPid": n}` chunk. */
export const childPidOf = (entries: LogEntry[]) => {
  for (const text of chunkTexts(entries)) {
    try {
      const parsed = JSON.parse(text) as { childPid?: unknown };
      if (typeof parsed.childPid === "number") return parsed.childPid;
    } catch {
      // Not the pid chunk.
    }
  }
  throw new Error("the spawn-child scenario reported no childPid");
};

/** Runs git in `dir` with no user or system config, so a test doesn't depend on (or sign with) the developer's. */
export const git = (dir: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};

/** Makes `dir` a git repo on `branch` with one empty commit. */
export const gitRepo = (dir: string, branch: string) => {
  git(dir, "init", "--quiet", "--initial-branch", branch);
  git(dir, "commit", "--quiet", "--allow-empty", "--message", "Start");
};
