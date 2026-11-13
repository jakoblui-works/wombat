// Agent manager: turns against the fake agent: replies, crashes, cancel, busy, plan and reasoning updates,
// unknown update kinds and a talkative stderr.
import { AgentSummary, LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { EARLY_TITLE } from "../../test/fake-agent.ts";
import { chunkTexts, isAlive, REPO, setup, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";

/** The entries besides the session's config options, which every fake scenario offers and the manager stores first. */
const withoutConfig = (entries: LogEntry[]) =>
  entries.filter((entry) => !(entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update"));

/** `withoutConfig`, and without the command list the fake agent sends as its session starts. */
const withoutConfigOrCommands = (entries: LogEntry[]) =>
  withoutConfig(entries).filter((entry) => !(entry.type === "session_update" && entry.update.sessionUpdate === "available_commands_update"));

const isZ = (timestamp: string) => timestamp.endsWith("Z") && new Date(timestamp).toISOString() === timestamp;

describe("turns", () => {
  test(
    "a reply turn: start records the session, the prompt and each chunk are entries, the turn ends end_turn, state done→working→done",
    async () => {
      const t = setup();
      const started = await t.manager.start("fake-reply", REPO);
      expect(AgentSummary.parse(started)).toEqual(started);
      expect(started).toMatchObject({ harness: "fake-reply", repo: REPO, state: "done", capabilities: { loadSession: false } });
      expect(started.sessionId).not.toBe("");
      expect(t.agent(started.id)).toEqual(started);

      const states: string[] = [];
      t.manager.onCommitted((event) => {
        if (event.type === "proposal") return;
        const state = t.agent(event.agentId)?.state;
        if (event.agentId === started.id && state && states.at(-1) !== state) states.push(state);
      });
      const { seq } = await t.manager.send(started.id, { text: "Say hello", commandId: "cmd_1" });
      const ended = await t.turnEnded(started.id);
      expect(ended.stopReason).toBe("end_turn");

      const entries = t.entries(started.id);
      for (const entry of entries) expect(LogEntry.parse(entry)).toEqual(entry);
      expect(withoutConfigOrCommands(entries)[0]).toMatchObject({ type: "user_message", text: "Say hello", commandId: "cmd_1", seq });
      expect(chunkTexts(entries).length).toBeGreaterThan(0);
      expect(chunkTexts(entries).every((text) => text !== "")).toBe(true);
      expect(entries.at(-1)?.type).toBe("turn_ended");

      await waitFor("state done", () => t.agent(started.id)?.state === "done");
      expect(states).toContain("working");
      expect(states.at(-1)).toBe("done");

      // Every timestamp the manager writes is UTC with Z (the store sorts them as text).
      const summary = t.agent(started.id);
      expect(summary && [summary.startedAt, summary.lastActivityAt].every(isZ)).toBe(true);
      expect(entries.every((entry) => isZ(entry.at))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a crash mid-turn: state error with an error detail, never a normal turn end, and the process is gone",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-crash", REPO);
      await t.manager.send(id, { text: "Go" });
      await waitFor("state error", () => t.agent(id)?.state === "error");

      expect(t.agent(id)?.error?.message).toBeTruthy();
      expect(t.entries(id).filter((entry) => entry.type === "turn_ended" && entry.stopReason === "end_turn")).toEqual([]);
      await waitFor("the crashed process to be gone", () => t.pids().every((pid) => !isAlive(pid)));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "hang then cancel: a second send meanwhile is busy and never reaches the agent; cancel ends the turn cancelled and the agent takes the next message",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-hang", REPO);
      await t.manager.send(id, { text: "Take your time" });
      await waitFor("state working", () => t.agent(id)?.state === "working");

      await expect(t.manager.send(id, { text: "Are you there?" })).rejects.toMatchObject({ code: "busy" });
      expect(t.entries(id).filter((entry) => entry.type === "user_message")).toHaveLength(1);

      await t.manager.cancel(id);
      expect((await t.turnEnded(id)).stopReason).toBe("cancelled");
      await waitFor("state done", () => t.agent(id)?.state === "done");
      expect(t.pids().every(isAlive)).toBe(true);

      await t.manager.send(id, { text: "Next one" });
      await waitFor("state working again", () => t.agent(id)?.state === "working");
      await t.manager.cancel(id);
      expect((await t.turnEnded(id, 2)).stopReason).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "update kinds we don't render are skipped with an update_skipped log line, and the turn goes on",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-unknown-update", REPO);
      await t.manager.send(id, { text: "Think first" });
      expect((await t.turnEnded(id)).stopReason).toBe("end_turn");

      const entries = t.entries(id);
      for (const entry of entries) expect(LogEntry.parse(entry)).toEqual(entry);
      expect(chunkTexts(entries).length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain("compaction_summary_chunk");
      expect(t.logs.map((line) => line.event)).toContain("update_skipped");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "plan and reasoning updates are stored as entries in order, and nothing is skipped",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-plan-thought", REPO);
      await t.manager.send(id, { text: "Plan it first" });
      expect((await t.turnEnded(id)).stopReason).toBe("end_turn");

      const updates = withoutConfigOrCommands(t.entries(id)).flatMap((entry) => (entry.type === "session_update" ? [entry.update] : []));
      expect(updates).toEqual([
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Weighing where the footer link lives." } },
        {
          sessionUpdate: "plan",
          entries: [
            { content: "Find the footer component", priority: "high", status: "completed" },
            { content: "Rename the footer link", priority: "medium", status: "in_progress" },
          ],
        },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Planned the footer change." } },
      ]);
      expect(t.logs.map((line) => line.event)).not.toContain("update_skipped");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an agent writing far more than a pipe buffer to stderr still finishes its turn",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-noisy", REPO);
      await t.manager.send(id, { text: "Be loud" });
      expect((await t.turnEnded(id)).stopReason).toBe("end_turn");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "updates sent while the session starts are stored after the agent, in order, and a title among them reaches the summary",
    async () => {
      const t = setup();
      const added: number[] = [];
      t.manager.onCommitted(({ seq, type }) => {
        if (type === "agent_added") added.push(seq);
      });
      const { id } = await t.manager.start("fake-early-update", REPO);
      await waitFor("the early updates", () => withoutConfig(t.entries(id)).length === 2);

      const entries = withoutConfig(t.entries(id));
      expect(entries.map((entry) => entry.type === "session_update" && entry.update.sessionUpdate)).toEqual([
        "available_commands_update",
        "session_info_update",
      ]);
      expect(added).toHaveLength(1);
      expect(entries.every((entry) => entry.seq > (added[0] ?? Number.POSITIVE_INFINITY))).toBe(true);
      await waitFor("the title", () => t.agent(id)?.title === EARLY_TITLE);
    },
    TEST_TIMEOUT_MS,
  );
});
