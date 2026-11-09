// Shared setup for the agent manager tests: a temp workspace with one repo, a temp store, fake agents that
// record their pids, a capturing logger and the committed events, all torn down after the test.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentSummary, Item } from "@wombat/shared/api";
import { onTestFinished } from "vitest";

import { createManager } from "../src/agents/manager.ts";
import type { Harness } from "../src/harness/harness.ts";
import { openStore, type Store } from "../src/store/store.ts";
import type { FakeScenario } from "./fake-agent.ts";
import { fakeHarness } from "./fake-harness.ts";

/** Per-test timeout and how long a test waits for an agent to get somewhere, in one place. */
export const TEST_TIMEOUT_MS = 15_000;
export const WAIT_MS = 8_000;

export const REPO = "site-web";

export type Manager = ReturnType<typeof createManager>;
export type LogLine = { event: string; fields: Record<string, string | number | boolean> };
export type Committed = { seq: number; agentId: string; type: string };

const RECORD_PID = pathToFileURL(join(import.meta.dirname, "record-pid.ts")).href;

/** The fake agent on `scenario`, with id `fake-<scenario>`, recording its pid in `pidDir`. */
export const trackedHarness = (scenario: FakeScenario, pidDir: string): Harness => {
  const fake = fakeHarness(scenario);
  return {
    ...fake,
    id: `fake-${scenario}`,
    spawn: (cwd, source) => {
      const spec = fake.spawn(cwd, source);
      return { ...spec, args: ["--import", RECORD_PID, ...spec.args], env: { ...spec.env, FAKE_AGENT_PID_DIR: pidDir } };
    },
  };
};

export const ALL_SCENARIOS: FakeScenario[] = [
  "reply",
  "permission",
  "image",
  "auth",
  "crash",
  "hang",
  "noisy",
  "spawn-child",
  "unknown-update",
  "detached-holder",
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

export type Setup = {
  manager: Manager;
  store: Store;
  storePath: string;
  root: string;
  pidDir: string;
  logs: LogLine[];
  committed: Committed[];
  /** Pids of every agent process started so far. */
  pids: () => number[];
  items: (agentId: string) => Item[];
  agent: (agentId: string) => AgentSummary | undefined;
  /** Waits until the agent has `count` turn_ended items (default 1), and returns the `count`th. */
  turnEnded: (agentId: string, count?: number) => Promise<Extract<Item, { type: "turn_ended" }>>;
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
export const setup = (): Setup => {
  const base = mkdtempSync(join(tmpdir(), "wombat-manager-"));
  const root = join(base, "workspace");
  mkdirSync(join(root, REPO), { recursive: true });
  const pidDir = join(base, "pids");
  mkdirSync(pidDir);
  const storePath = join(base, "state", "wombat", "service.db");
  const harnesses = ALL_SCENARIOS.map((scenario) => trackedHarness(scenario, pidDir));
  const logs: LogLine[] = [];
  const committed: Committed[] = [];

  const make = (store: Store) => {
    const manager = createManager({
      store,
      workspaceRoot: root,
      harnesses,
      log: (event: string, fields: LogLine["fields"]) => logs.push({ event, fields }),
      env: process.env,
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
    try {
      state.store?.close();
    } catch {
      // Already closed.
    }
    rmSync(base, { recursive: true, force: true });
  });
  state.store = openStore({ path: storePath });
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
    storePath,
    root,
    pidDir,
    logs,
    committed,
    pids,
    items: (agentId) => setupObject.store.items(agentId).items,
    agent: (agentId) => setupObject.store.listAgents().find((agent) => agent.id === agentId),
    turnEnded: async (agentId, count = 1) => {
      let ended: Extract<Item, { type: "turn_ended" }>[] = [];
      await waitFor(`turn ${count} of ${agentId} to end`, () => {
        ended = setupObject.items(agentId).filter((item) => item.type === "turn_ended");
        return ended.length >= count;
      });
      const turn = ended[count - 1];
      if (!turn) throw new Error("no turn_ended");
      return turn;
    },
    restart: async () => {
      await state.manager?.shutdown();
      state.store?.close();
      state.store = openStore({ path: storePath });
      state.manager = make(state.store);
    },
  };
  return setupObject;
};

/** Text of the agent_message_chunk items, in order. */
export const chunkTexts = (items: Item[]) =>
  items.flatMap((item) =>
    item.type === "session_update" &&
    item.update.sessionUpdate === "agent_message_chunk" &&
    item.update.content.type === "text"
      ? [item.update.content.text]
      : [],
  );

/** The pid of the child the spawn-child scenario started, from its `{"childPid": n}` chunk. */
export const childPidOf = (items: Item[]) => {
  for (const text of chunkTexts(items)) {
    try {
      const parsed = JSON.parse(text) as { childPid?: unknown };
      if (typeof parsed.childPid === "number") return parsed.childPid;
    } catch {
      // Not the pid chunk.
    }
  }
  throw new Error("the spawn-child scenario reported no childPid");
};
