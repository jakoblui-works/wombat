// Lasting check (silent failure): every turn in an agent's stored log ends with exactly one turn_ended, so a
// reader of the log alone sees each turn end. A successful turn keeps ACP's stopReason; a turn the agent fails
// (the prompt is rejected while the connection stays open) ends with "error"; a turn whose process ends under it
// (crash, kill, stop, service shutdown) ends with "stopped". A failed turn whose process then ends gets no second
// one. A missing or doubled entry only shows to a later reader, so nothing else would catch it.
import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { isAlive, REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";

/**
 * The log cut into turns (each starts at a user_message): per turn, the stopReasons of its turn_ended entries,
 * and whether a turn_ended is the turn's last entry.
 */
const turns = (entries: LogEntry[]) => {
  const found: { ends: string[]; endsLast: boolean }[] = [];
  for (const entry of entries) {
    if (entry.type === "user_message") {
      found.push({ ends: [], endsLast: false });
      continue;
    }
    const turn = found.at(-1);
    if (!turn) continue;
    if (entry.type === "turn_ended") turn.ends.push(entry.stopReason);
    turn.endsLast = entry.type === "turn_ended";
  }
  return found;
};

/** Starts an agent on `harness`; returns its id and its process's pid. */
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

/** How many agent_changed events the agent has had so far. */
const changes = (t: Setup, id: string) => t.committed.filter((event) => event.type === "agent_changed" && event.agentId === id).length;

describe("turn_ended", () => {
  test(
    "successful turns: each ends with one turn_ended carrying ACP's stopReason",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-reply", REPO);
      await t.manager.send(id, { text: "Say hello" });
      await t.turnEnded(id);
      await waitFor("state done", () => t.agent(id)?.state === "done");
      await t.manager.send(id, { text: "And again" });
      await t.turnEnded(id, 2);
      await waitFor("state done again", () => t.agent(id)?.state === "done");

      expect(turns(t.entries(id))).toEqual([
        { ends: ["end_turn"], endsLast: true },
        { ends: ["end_turn"], endsLast: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a failed turn ends with one turn_ended error, the next failed turn too; the process then ending adds none",
    async () => {
      const t = setup();
      const { id, pid } = await startTracked(t, "fake-prompt-error");

      await t.manager.send(id, { text: "Fix the footer" });
      await waitFor("the failed turn (state error)", () => t.agent(id)?.state === "error");
      // The process lives on: this is the failed-turn path, not a crash.
      expect(isAlive(pid)).toBe(true);
      expect(turns(t.entries(id))).toEqual([{ ends: ["error"], endsLast: true }]);

      // A second call on the same live process: its own turn, its own single end.
      // send() sets the state working before it resolves, so the error below is the second turn's.
      await t.manager.send(id, { text: "Try once more" });
      await waitFor("the second failed turn (state error again)", () => t.agent(id)?.state === "error");
      expect(isAlive(pid)).toBe(true);

      // Now the process ends with no turn running: its close handler must not end either turn again.
      const before = changes(t, id);
      kill(pid);
      await waitFor("the exit recorded", () => !isAlive(pid) && changes(t, id) > before);

      expect(turns(t.entries(id))).toEqual([
        { ends: ["error"], endsLast: true },
        { ends: ["error"], endsLast: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  // Each way a process can end while its turn runs; the close handler ends the turn.
  const ENDINGS: { how: string; harness: string; end: (t: Setup, id: string, pid: number) => Promise<void> }[] = [
    {
      how: "the agent crashes",
      harness: "fake-crash",
      end: (t, id) => waitFor("the crash recorded", () => t.agent(id)?.state === "error"),
    },
    {
      how: "the process is killed",
      harness: "fake-hang",
      end: async (t, id, pid) => {
        kill(pid);
        await waitFor("the kill recorded", () => t.agent(id)?.state === "error");
      },
    },
    { how: "the agent is stopped", harness: "fake-hang", end: (t, id) => t.manager.stop(id) },
    { how: "the service shuts down", harness: "fake-hang", end: (t) => t.manager.shutdown() },
  ];

  test.each(ENDINGS)(
    "a turn whose process ends under it ends with one turn_ended stopped: $how",
    async ({ harness, end }) => {
      const t = setup();
      const { id, pid } = await startTracked(t, harness);
      await t.manager.send(id, { text: "Work on it" });
      await waitFor("state working", () => t.agent(id)?.state === "working" || t.agent(id)?.state === "error");

      await end(t, id, pid);
      await waitFor("the agent process gone", () => !isAlive(pid));

      expect(turns(t.entries(id))).toEqual([{ ends: ["stopped"], endsLast: true }]);
    },
    TEST_TIMEOUT_MS,
  );
});
