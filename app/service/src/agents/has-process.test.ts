// Lasting check (D15, D18, silent failure): an agent's summary says `hasProcess: true` exactly while its process
// runs, whatever its state: after start, through and after a turn, after a failed turn (state error, process
// alive); false once the process ends (stop, exit), and for every agent a restarted service loads, including one
// stored as still having a process by a service that died. The app reads it as it would: the stored summary
// parsed with the shared schema (what GET /agents returns), and the summary as of each agent_changed alert (when
// the app refetches). A stale value offers Stop for a dead process or hides it for a live one.
import { AgentSummary } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { isAlive, REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";
import { summary } from "../../test/store-fixtures.ts";

/** The field as the app reads it: off the summary parsed with the shared schema (older summaries read false). */
const hasProcess = (stored: AgentSummary | undefined): boolean | undefined =>
  stored === undefined ? undefined : AgentSummary.parse(stored).hasProcess;

/** The agent's hasProcess as stored at its latest agent_added/agent_changed alert, and as stored now. */
const watch = (t: Setup) => {
  const announced = new Map<string, unknown>();
  t.manager.onCommitted((event) => {
    if (event.type !== "agent_added" && event.type !== "agent_changed") return;
    announced.set(event.agentId, hasProcess(t.agent(event.agentId)));
  });
  return (id: string) => ({ stored: hasProcess(t.agent(id)), announced: announced.get(id) });
};

const both = (value: boolean) => ({ stored: value, announced: value });

const startTracked = async (t: Setup, harness: string) => {
  const before = new Set(t.pids());
  const { id } = await t.manager.start(harness, REPO);
  const [pid] = t.pids().filter((p) => !before.has(p));
  if (pid === undefined) throw new Error("no agent pid recorded");
  return { id, pid };
};

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

describe("hasProcess", () => {
  test(
    "true after start, while working and once done; false once stopped",
    async () => {
      const t = setup();
      const read = watch(t);
      const { id, pid } = await startTracked(t, "fake-hang");
      expect(read(id)).toEqual(both(true));

      await t.manager.send(id, { text: "Take your time" });
      await waitFor("state working", () => t.agent(id)?.state === "working");
      expect(read(id)).toEqual(both(true));

      await t.manager.cancel(id);
      await waitFor("state done", () => t.agent(id)?.state === "done");
      expect(isAlive(pid)).toBe(true);
      expect(read(id)).toEqual(both(true));

      await t.manager.stop(id);
      expect(isAlive(pid)).toBe(false);
      expect(read(id)).toEqual(both(false));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a failed turn leaves it true (state error, process alive); the process then exiting makes it false",
    async () => {
      const t = setup();
      const read = watch(t);
      const { id, pid } = await startTracked(t, "fake-prompt-error");
      await t.manager.send(id, { text: "Fix the footer" });
      await waitFor("the failed turn (state error)", () => t.agent(id)?.state === "error");
      expect(isAlive(pid)).toBe(true);
      expect(read(id)).toEqual(both(true));

      const turnError = t.agent(id)?.error?.message;
      kill(pid);
      // The exit rewrites the error detail; wait for that, not for the field under test.
      await waitFor("the exit recorded", () => !isAlive(pid) && t.agent(id)?.error?.message !== turnError);
      expect(read(id)).toEqual(both(false));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a done agent whose process exits by itself: false",
    async () => {
      const t = setup();
      const read = watch(t);
      const { id, pid } = await startTracked(t, "fake-reply");
      await t.manager.send(id, { text: "Say hello" });
      await waitFor("state done", () => t.agent(id)?.state === "done" && t.entries(id).some((e) => e.type === "turn_ended"));
      expect(read(id)).toEqual(both(true));

      kill(pid);
      await waitFor("the exit recorded", () => !isAlive(pid) && t.agent(id)?.state === "error");
      expect(read(id)).toEqual(both(false));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a restarted service loads every agent false: one it ran, and ones a dead service left stored as having a process",
    async () => {
      const t = setup();
      const { id: ran } = await t.manager.start("fake-reply", REPO);
      expect(hasProcess(t.agent(ran))).toBe(true);
      // What a service killed before it could record the ends leaves behind: summaries still saying true, among
      // them an error agent (a failed turn, process alive at the time), and one from before the field existed.
      const failedTurn = { code: "agent_failed" as const, message: "The agent reported an error during the turn." };
      t.store.putAgent(summary("left-done", { state: "done", hasProcess: true }));
      t.store.putAgent(summary("left-error", { state: "error", error: failedTurn, hasProcess: true }));
      // Stored as a service from before the field wrote it: no hasProcess key at all.
      const older: Partial<AgentSummary> = summary("older", { state: "error", error: failedTurn });
      delete older.hasProcess;
      t.store.putAgent(older as AgentSummary);

      await t.restart();

      const loaded = Object.fromEntries(t.store.listAgents().map((agent) => [agent.id, hasProcess(agent)]));
      expect(loaded).toEqual({ [ran]: false, "left-done": false, "left-error": false, older: false });
    },
    TEST_TIMEOUT_MS,
  );
});
