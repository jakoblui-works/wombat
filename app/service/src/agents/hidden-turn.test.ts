// Lasting checks (S2c, T13, rows T13-1 to T13-4; silent failures): `manager.contextBreakdown` runs `/context` as a
// hidden turn. Whatever the agent sends during it never reaches the agent's log, summary or events; nothing else runs
// beside it, and it never starts beside a running turn; a failed one leaves the agent usable. Against the fake agent,
// whose `/context` answer sends a message chunk, a usage_update and a title before its report (fake-agent.ts).
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import {
  CONTEXT_CANCELLED_FILE,
  CONTEXT_FAILURE_MESSAGE,
  CONTEXT_RELEASE_FILE,
  CONTEXT_STARTED_FILE,
  FAKE_BREAKDOWN,
  FAKE_CONFIG,
} from "../../test/fake-agent.ts";
import { GIVE_UP_HARNESS, REPO, setup, TEST_TIMEOUT_MS, waitFor, WAIT_MS, type Setup } from "../../test/manager-fixtures.ts";

/** The rejection of `promise`, or undefined if it resolves; "no answer" if it does neither within WAIT_MS. */
const refusal = (promise: Promise<unknown>): Promise<unknown> =>
  Promise.race([
    promise.then(
      () => undefined,
      (reason: unknown) => reason,
    ),
    new Promise((resolve) => setTimeout(() => resolve("no answer"), WAIT_MS)),
  ]);

const eventsOf = (t: Setup, agentId: string) => t.committed.filter((event) => (event as { agentId?: string }).agentId === agentId).length;

/** Starts the agent and waits until its session's options are stored, so nothing of the start is still arriving. */
const started = async (t: Setup, harness: string): Promise<string> => {
  const { id } = await t.manager.start(harness, REPO);
  await waitFor("the session's options in the log", () =>
    t.entries(id).some((entry: LogEntry) => entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update"),
  );
  return id;
};

/** Starts a hidden turn on a fake-hang agent and waits until its `/context` prompt has reached the agent. */
const heldContext = async (t: Setup, agentId: string) => {
  const folder = join(t.root, REPO);
  const breakdown = t.manager.contextBreakdown(agentId);
  breakdown.catch(() => undefined);
  await waitFor("the /context prompt at the agent", () => existsSync(join(folder, CONTEXT_STARTED_FILE)));
  return { breakdown, release: () => writeFileSync(join(folder, CONTEXT_RELEASE_FILE), "") };
};

test(
  "T13-1: a /context turn answers the agent's breakdown and leaves the agent's log, summary and events as they were",
  async () => {
    const t = setup();
    const id = await started(t, "fake-reply");
    await t.manager.send(id, { text: "Hello" });
    await t.turnEnded(id);
    await waitFor("state done", () => t.agent(id)?.state === "done");
    const entries = t.entries(id);
    const summary = t.agent(id);
    const events = eventsOf(t, id);

    expect(await t.manager.contextBreakdown(id)).toEqual(FAKE_BREAKDOWN);

    expect(t.entries(id), "no entry: not the prompt, the chunk, the usage, the title or the turn's end").toEqual(entries);
    expect(t.agent(id), "the summary: state, lastText, lastUserAt, activity, title").toEqual(summary);
    expect(eventsOf(t, id), "no event for the agent").toBe(events);
  },
  TEST_TIMEOUT_MS,
);

describe("T13-2: while a hidden turn runs, nothing else does", () => {
  test.each<[string, (t: Setup, agentId: string) => Promise<unknown>]>([
    ["a message", (t, id) => t.manager.send(id, { text: "Are you still there?" })],
    ["a config change", (t, id) => t.manager.setConfig(id, FAKE_CONFIG.fast.id, true)],
  ])(
    "%s is busy and stores nothing; once the hidden turn ends, a message is accepted",
    async (_what, call) => {
      const t = setup();
      const id = await started(t, "fake-hang");
      const entries = t.entries(id);
      const held = await heldContext(t, id);

      expect(await refusal(call(t, id))).toMatchObject({ code: "busy" });
      expect(t.entries(id)).toEqual(entries);

      held.release();
      expect(await held.breakdown).toEqual(FAKE_BREAKDOWN);
      await expect(t.manager.send(id, { text: "Now take your time" })).resolves.toHaveProperty("seq");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("T13-3: a hidden turn never starts beside another turn", () => {
  test(
    "a /context while a turn runs is busy, and the turn runs on untouched",
    async () => {
      const t = setup();
      const id = await started(t, "fake-hang");
      await t.manager.send(id, { text: "Take your time" });
      await waitFor("state working", () => t.agent(id)?.state === "working");
      const entries = t.entries(id);

      expect(await refusal(t.manager.contextBreakdown(id))).toMatchObject({ code: "busy" });
      expect(t.entries(id)).toEqual(entries);
      expect(t.agent(id)?.state).toBe("working");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a second /context while one runs is busy",
    async () => {
      const t = setup();
      const id = await started(t, "fake-hang");
      const held = await heldContext(t, id);

      expect(await refusal(t.manager.contextBreakdown(id))).toMatchObject({ code: "busy" });

      held.release();
      expect(await held.breakdown).toEqual(FAKE_BREAKDOWN);
    },
    TEST_TIMEOUT_MS,
  );
});

test(
  "T13-4: a failed /context answers agent_error with the agent's message, logs nothing, and leaves the agent usable",
  async () => {
    const t = setup();
    const id = await started(t, "fake-prompt-error");
    const entries = t.entries(id);
    const summary = t.agent(id);

    const error = await refusal(t.manager.contextBreakdown(id));
    expect(error).toMatchObject({ code: "agent_error" });
    expect((error as Error).message).toContain(CONTEXT_FAILURE_MESSAGE);
    expect(t.entries(id), "not even the chunk sent before the failure").toEqual(entries);
    expect(t.agent(id)).toEqual(summary);

    await expect(t.manager.send(id, { text: "Try something else" }), "not busy for good").resolves.toHaveProperty("seq");
  },
  TEST_TIMEOUT_MS,
);

/** Sends `text` as soon as the agent stops answering busy; the send's outcome (its `{ seq }`, or another error). */
const sendWhenIdle = async (t: Setup, agentId: string, text: string): Promise<unknown> => {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const outcome = await t.manager.send(agentId, { text }).then(
      (sent) => sent,
      (error: unknown) => error,
    );
    if ((outcome as { code?: unknown }).code !== "busy") return outcome;
    if (Date.now() > deadline) throw new Error("the agent was still busy");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

// S2c, T13 (row T13-17; silent): a harness that gives up on the report (a timeout) while the agent still holds the
// /context prompt. The manager cancels that prompt and stays hidden until the agent answers it: what the agent sends
// late never reaches the log, and the agent takes messages again afterwards. GIVE_UP_HARNESS gives up after
// CONTEXT_GIVE_UP_MS; the hang scenario holds /context until a cancel, then sends its updates and answers cancelled.
test(
  "T13-17: a hidden turn the harness gave up on is cancelled; its late updates never reach the log, and a send is accepted once the prompt is answered",
  async () => {
    const t = setup();
    const id = await started(t, GIVE_UP_HARNESS);
    const folder = join(t.root, REPO);
    const entries = t.entries(id);
    const summary = t.agent(id);

    expect(await refusal(t.manager.contextBreakdown(id))).toMatchObject({ code: "agent_error" });
    expect(existsSync(join(folder, CONTEXT_STARTED_FILE)), "control: the /context prompt reached the agent").toBe(true);

    await waitFor("session/cancel at the agent", () => existsSync(join(folder, CONTEXT_CANCELLED_FILE)));
    const text = "Back to the opening hours";
    expect(await sendWhenIdle(t, id, text), "a send once the cancelled prompt is answered").toHaveProperty("seq");

    // The late updates came before the prompt's answer, so they had arrived by the time the send went through.
    const after = t.entries(id);
    const sentAt = after.findIndex((entry: LogEntry) => entry.type === "user_message" && entry.text === text);
    expect(after.slice(0, sentAt), "nothing of the hidden turn, early or late").toEqual(entries);
    expect(t.agent(id)?.title, "the late title dropped").toBe(summary?.title);
  },
  TEST_TIMEOUT_MS,
);
