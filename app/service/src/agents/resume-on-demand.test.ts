// A setting picked for an agent without a process starts it, as a message does, and
// answers as on a running agent; an agent whose harness can't resume stays stopped, and nothing is spawned for it.
// A stop or delete while a message's resume is under way ends whatever the resume started (no process nobody can stop).
import type { LogEntry } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { FAKE_CONFIG } from "../../test/fake-agent.ts";
import { isAlive, REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";

const latestConfig = (entries: LogEntry[]) => {
  const options = entries.flatMap((entry) =>
    entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update" ? [entry.update.configOptions] : [],
  );
  return Object.fromEntries((options.at(-1) ?? []).map((option) => [option.id, option.currentValue]));
};

test(
  "a setting on a stopped agent resumes it, sets the value and leaves it done and running, with no turn",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.stop(id);

    await t.manager.setConfig(id, FAKE_CONFIG.effort.id, "high");

    expect(latestConfig(t.entries(id))).toMatchObject({ [FAKE_CONFIG.effort.id]: "high" });
    expect(t.agent(id)).toMatchObject({ state: "done", hasProcess: true });
    expect(t.entries(id).filter((entry) => entry.type === "user_message" || entry.type === "turn_ended")).toEqual([]);
    // A value the agent doesn't offer is refused as on a running agent.
    await expect(t.manager.setConfig(id, FAKE_CONFIG.effort.id, "extreme")).rejects.toMatchObject({ code: "invalid_request" });
  },
  TEST_TIMEOUT_MS,
);

/** Waits until the agent's resume attempt has settled, one way or the other. */
const resumeSettled = (t: Setup, agentId: string) =>
  waitFor("the resume attempt to settle", () =>
    t.logs.some((line) => (line.event === "agent_resumed" || line.event === "agent_resume_failed") && line.fields.agentId === agentId),
  );

test(
  "a delete while a message's resume waits on the stopping process leaves no live process and nothing stored",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    const stopping = t.manager.stop(id);
    await t.manager.send(id, { text: "Still there?" });
    await t.manager.delete(id);
    await stopping;
    await resumeSettled(t, id);

    await waitFor("no live agent process", () => t.pids().every((pid) => !isAlive(pid)));
    expect(t.store.listAgents()).toEqual([]);
    expect(t.entries(id)).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

test(
  "a stop while a message's resume is under way ends the resumed process: stopped, no live process, the turn ended",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.stop(id);
    await waitFor("the first process gone", () => t.pids().every((pid) => !isAlive(pid)));

    await t.manager.send(id, { text: "Still there?" });
    await t.manager.stop(id);
    await resumeSettled(t, id);

    await waitFor("no live agent process", () => t.pids().every((pid) => !isAlive(pid)));
    expect(t.agent(id)).toMatchObject({ state: "stopped", hasProcess: false });
    expect(t.entries(id).at(-1)).toMatchObject({ type: "turn_ended" });
  },
  TEST_TIMEOUT_MS,
);

test(
  "a cancel while a message waits for the agent to start ends that turn as cancelled, without sending it, and the agent runs on",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.stop(id);

    await t.manager.send(id, { text: "Never mind" });
    await t.manager.cancel(id);
    const ended = await t.turnEnded(id);

    expect(ended.stopReason).toBe("cancelled");
    expect(t.entries(id).filter((entry) => entry.type === "session_update" && entry.update.sessionUpdate === "agent_message_chunk")).toEqual([]);
    expect(t.agent(id)).toMatchObject({ state: "done", hasProcess: true });
    await t.manager.send(id, { text: "Say hello to the bakery" });
    expect((await t.turnEnded(id, 2)).stopReason).toBe("end_turn");
  },
  TEST_TIMEOUT_MS,
);
