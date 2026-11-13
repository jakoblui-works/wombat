// Agent manager: starting (and failing to), commandId retries, stop, delete, start-up after a restart, and
// shutdown.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { AgentSummary, SERVICE_STOP_REASON, type LogEntry } from "@wombat/shared/api";
import { describe, expect, onTestFinished, test } from "vitest";

import { summary, textChunk } from "../../test/store-fixtures.ts";
import { FAKE_CONFIG, NO_RESUME_CAPABILITY_FILE, RESUME_REFUSED_FILE } from "../../test/fake-agent.ts";
import {
  childPidOf,
  chunkTexts,
  groupAlive,
  isAlive,
  REPO,
  setup,
  TEST_TIMEOUT_MS,
  waitFor,
  WAIT_MS,
  type Setup,
} from "../../test/manager-fixtures.ts";
import { fakeHarness } from "../../test/fake-harness.ts";

/** Starts the spawn-child scenario and runs one turn; returns the agent id and the pids it caused. */
const withChild = async (t: Setup) => {
  const before = new Set(t.pids());
  const { id } = await t.manager.start("fake-spawn-child", REPO);
  await t.manager.send(id, { text: "Start a helper" });
  await t.turnEnded(id);
  const [agentPid] = t.pids().filter((pid) => !before.has(pid));
  if (agentPid === undefined) throw new Error("no agent pid recorded");
  const childPid = childPidOf(t.entries(id));
  expect(isAlive(agentPid) && isAlive(childPid)).toBe(true);
  return { id, agentPid, childPid };
};

const gone = (what: string, pids: number[], groups: number[] = []) =>
  waitFor(what, () => pids.every((pid) => !isAlive(pid)) && groups.every((pgid) => !groupAlive(pgid)));

describe("start", () => {
  test(
    "auth required: start fails with auth_required and the harness's login hint, records no agent and leaves no process",
    async () => {
      const t = setup();
      await expect(t.manager.start("fake-auth", REPO)).rejects.toMatchObject({
        code: "auth_required",
        hint: fakeHarness("auth").loginHint,
      });
      expect(t.store.listAgents()).toEqual([]);
      expect(t.pids()).toHaveLength(1);
      await gone("the agent process", t.pids());
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a repo that is a symlink out of the workspace is rejected and nothing is spawned",
    async () => {
      const t = setup();
      const outside = join(dirname(t.root), "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(t.root, "escape"));

      await expect(t.manager.start("fake-reply", "escape")).rejects.toMatchObject({ code: "repo_outside_workspace" });
      await expect(t.manager.start("fake-reply", "missing")).rejects.toMatchObject({ code: "repo_not_found" });
      await expect(t.manager.start("no-such-harness", REPO)).rejects.toMatchObject({ code: "unknown_harness" });
      expect(t.pids()).toEqual([]);
      expect(t.store.listAgents()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("commandId", () => {
  test(
    "a repeated commandId returns the original seq and isn't sent again, also after stop and a restart; a new one is sent",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-reply", REPO);
      const first = await t.manager.send(id, { text: "Say hello", commandId: "cmd_a" });
      await t.turnEnded(id);

      expect(await t.manager.send(id, { text: "Say hello", commandId: "cmd_a" })).toEqual(first);
      // A new commandId right after: had the repeat been sent, this would be busy or show a third turn.
      const second = await t.manager.send(id, { text: "Again", commandId: "cmd_b" });
      expect(second.seq).not.toBe(first.seq);
      await t.turnEnded(id, 2);
      const count = (type: string) => t.entries(id).filter((entry) => entry.type === type).length;
      expect([count("user_message"), count("turn_ended")]).toEqual([2, 2]);

      await t.manager.stop(id);
      expect(await t.manager.send(id, { text: "Say hello", commandId: "cmd_a" })).toEqual(first);
      await t.restart();
      expect(await t.manager.send(id, { text: "Say hello", commandId: "cmd_a" })).toEqual(first);
      expect([count("user_message"), count("turn_ended")]).toEqual([2, 2]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("stop and delete", () => {
  test(
    "stop ends the agent's process group, state stopped, history kept",
    async () => {
      const t = setup();
      const { id, agentPid, childPid } = await withChild(t);
      const history = t.entries(id);

      await t.manager.stop(id);
      expect(isAlive(agentPid)).toBe(false);
      await gone("the agent's process group", [agentPid, childPid], [agentPid]);
      expect(t.agent(id)?.state).toBe("stopped");
      expect(t.entries(id)).toEqual(history);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "delete stops a running agent and removes its summary and entries; deleting again or an unknown id is not_found",
    async () => {
      const t = setup();
      const { id, agentPid, childPid } = await withChild(t);
      const other = await t.manager.start("fake-reply", REPO);

      await t.manager.delete(id);
      await gone("the deleted agent's process group", [agentPid, childPid], [agentPid]);
      expect(t.store.listAgents().map((agent) => agent.id)).toEqual([other.id]);
      expect(t.store.readLog(id)).toEqual({ entries: [], truncated: false });
      await expect(t.manager.delete(id)).rejects.toMatchObject({ code: "not_found" });
      await expect(t.manager.delete("no-such-agent")).rejects.toMatchObject({ code: "not_found" });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("start-up and shutdown", () => {
  test(
    "on start-up, stored agents without a process are marked stopped (error stays error), each taking a seq; history stays",
    async () => {
      const t = setup();
      await t.manager.shutdown();
      const states = ["working", "waiting", "done", "error", "stopped"] as const;
      for (const state of states) {
        t.store.putAgent(
          summary(state, state === "error" ? { state, error: { code: "agent_failed", message: "The agent exited." } } : { state }),
        );
        t.store.append(state, [textChunk(`History of the ${state} agent.`)]);
      }
      const seqBefore = t.store.currentSeq();

      await t.restart();

      expect(Object.fromEntries(t.store.listAgents().map((agent) => [agent.id, agent.state]))).toEqual({
        working: "stopped",
        waiting: "stopped",
        done: "stopped",
        error: "error",
        stopped: "stopped",
      });
      expect(t.store.currentSeq()).toBe(seqBefore + 3);
      for (const state of states) expect(t.entries(state)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "shutdown kills every agent's process group, grandchildren included; a second shutdown is safe and later calls fail",
    async () => {
      const t = setup();
      const one = await withChild(t);
      const two = await withChild(t);

      await t.manager.shutdown();
      await gone(
        "every agent process group",
        [one.agentPid, one.childPid, two.agentPid, two.childPid],
        [one.agentPid, two.agentPid],
      );
      await expect(t.manager.shutdown()).resolves.toBeUndefined();
      await expect(t.manager.send(one.id, { text: "Hello?" })).rejects.toThrow(/\w/);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "stop resolves and records stopped even when a detached grandchild still holds the agent's stderr",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-detached-holder", REPO);
      await t.manager.send(id, { text: "Start a background helper" });
      await t.turnEnded(id);
      const holderPid = childPidOf(t.entries(id));
      // It's in its own process group, so nothing the manager does to the agent's group reaches it.
      const killHolder = () => {
        for (const target of [-holderPid, holderPid]) {
          try {
            process.kill(target, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      };
      onTestFinished(killHolder);
      expect(isAlive(holderPid)).toBe(true);

      let timer: NodeJS.Timeout | undefined;
      try {
        const outcome = await Promise.race([
          t.manager.stop(id).then(() => "stopped"),
          new Promise((resolve) => (timer = setTimeout(() => resolve("still waiting"), WAIT_MS))),
        ]);
        expect(outcome, `stop(${id}) within ${WAIT_MS} ms`).toBe("stopped");
        expect(t.agent(id)?.state).toBe("stopped");
      } finally {
        clearTimeout(timer);
        // Before the setup's cleanup shuts the manager down, which would wait on the same pipe.
        killHolder();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// S2d, T19: a message to an agent without a process resumes its session (session/resume) in a new process, under the
// same agent and the same log. What a silent failure here would look like: Claude starting a fresh conversation under
// the old chat, the history written twice, or a second process nobody stops.
describe("resume", () => {
  /** The session ids the entries carry (the ones that carry one). */
  const sessionsOf = (entries: LogEntry[]) =>
    [...new Set(entries.flatMap((entry) => ("sessionId" in entry && entry.sessionId !== undefined ? [entry.sessionId] : [])))];
  const hasProcess = (t: Setup, id: string) => {
    const stored = t.agent(id);
    return stored === undefined ? undefined : AgentSummary.parse(stored).hasProcess;
  };
  /** A fake-reply agent that answered one message and was stopped; its stored session id and log. */
  const stoppedAfterOneTurn = async (t: Setup) => {
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.send(id, { text: "Say hello to the bakery" });
    await t.turnEnded(id);
    const sessionId = t.agent(id)?.sessionId;
    if (!sessionId) throw new Error("no stored session id");
    await t.manager.stop(id);
    await gone("the first process", t.pids());
    return { id, sessionId, history: t.entries(id), spawned: t.pids().length };
  };

  test(
    "T19-1: a message to a stopped agent continues the same chat: same agent, its stored session id on every new entry, the history before it untouched, one user message per send",
    async () => {
      const t = setup();
      const { id, sessionId, history, spawned } = await stoppedAfterOneTurn(t);

      const { seq } = await t.manager.send(id, { text: "Are you still there?" });
      const ended = await t.turnEnded(id, 2);

      expect(ended.stopReason).toBe("end_turn");
      const entries = t.entries(id);
      expect(entries.slice(0, history.length), "the history before the resume, as it was").toEqual(history);
      const added = entries.slice(history.length);
      expect(added.filter((entry) => entry.type === "user_message"), "the one message sent").toEqual([
        expect.objectContaining({ seq, text: "Are you still there?" }),
      ]);
      expect(sessionsOf(added), "the new entries' session: the stored one, not a fresh one").toEqual([sessionId]);
      expect(chunkTexts(added).join(""), "the reply").toBe("Hello from the fake agent.");
      expect(t.store.listAgents().map((agent) => agent.id), "no second agent").toEqual([id]);
      expect(t.agent(id)).toMatchObject({ sessionId, state: "done" });
      expect(hasProcess(t, id)).toBe(true);
      expect(t.pids(), "one new agent process").toHaveLength(spawned + 1);

      // A resumed process ends as a started one does.
      await t.manager.stop(id);
      expect(t.agent(id)?.state).toBe("stopped");
      expect(hasProcess(t, id)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  // D27: never a fresh session under the old chat (Claude would silently forget the conversation).
  test.each([
    ["the agent refuses session/resume", RESUME_REFUSED_FILE],
    ["the agent doesn't offer session/resume at initialize", NO_RESUME_CAPABILITY_FILE],
  ])(
    "T19-6: when %s, the message stays, its turn ends failed, the agent is in error with its session and log kept and no process left, and the next message tries again",
    async (_what, file) => {
      const t = setup();
      const folder = join(t.root, REPO);
      const { id, sessionId, history, spawned } = await stoppedAfterOneTurn(t);
      writeFileSync(join(folder, file), "");

      const { seq } = await t.manager.send(id, { text: "Are you back?" });
      const failed = await t.turnEnded(id, 2);
      await waitFor("state error", () => t.agent(id)?.state === "error");

      expect(failed.stopReason).toBe(SERVICE_STOP_REASON.error);
      expect(t.entries(id).slice(0, history.length), "the history before the attempt, as it was").toEqual(history);
      // Nothing from any session: a fresh one would have written its options and its reply.
      expect(t.entries(id).slice(history.length).map(({ type, seq: at }) => ({ type, at })), "the message and its failed end only").toEqual([
        { type: "user_message", at: seq },
        { type: "turn_ended", at: failed.seq },
      ]);
      expect(t.agent(id)?.error?.message, "a message that names the remedy").toBeTruthy();
      expect(t.agent(id)?.sessionId, "the stored session").toBe(sessionId);
      expect(t.store.listAgents().map((agent) => agent.id), "the agent is kept").toEqual([id]);
      expect(t.pids(), "it did try, in a new process").toHaveLength(spawned + 1);
      await gone("the failed attempt's process", t.pids());
      expect(hasProcess(t, id)).toBe(false);

      // The next message tries again, and this time the agent takes the session back.
      rmSync(join(folder, file));
      const before = t.entries(id).length;
      await t.manager.send(id, { text: "Now?" });
      const ended = await t.turnEnded(id, 3);
      expect(ended.stopReason).toBe("end_turn");
      expect(sessionsOf(t.entries(id).slice(before)), "the stored session again").toEqual([sessionId]);
      expect(t.agent(id)).toMatchObject({ sessionId, state: "done" });
      expect(hasProcess(t, id)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "T19-7: a send and two settings on a stopped agent share one resume (one new process); a second send meanwhile is busy",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-reply", REPO);
      await t.manager.stop(id);
      await gone("the first process", t.pids());
      const spawned = t.pids().length;

      const sent = t.manager.send(id, { text: "One" });
      const second = t.manager.send(id, { text: "Two" }).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      const effort = t.manager.setConfig(id, FAKE_CONFIG.effort.id, "high");
      const fast = t.manager.setConfig(id, FAKE_CONFIG.fast.id, true);
      const together = Promise.all([sent, effort, fast]);
      together.catch(() => undefined);

      expect(await second, "a second message while the first one's resume runs").toMatchObject({ code: "busy" });
      await together;
      await t.turnEnded(id);

      expect(t.pids(), "one process for all three").toHaveLength(spawned + 1);
      expect(t.entries(id).filter((entry) => entry.type === "user_message").map((entry) => (entry.type === "user_message" ? entry.text : ""))).toEqual(["One"]);
      const options = t.entries(id).flatMap((entry) =>
        entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update" ? [entry.update.configOptions] : [],
      );
      const latest = Object.fromEntries((options.at(-1) ?? []).map((option) => [option.id, option.currentValue]));
      expect(latest, "both settings reached the one agent").toMatchObject({ [FAKE_CONFIG.effort.id]: "high", [FAKE_CONFIG.fast.id]: true });
      // Every process but the live one is gone: a second resume would leave one running.
      await waitFor("only the live agent process left", () => t.pids().filter((pid) => isAlive(pid)).length === 1);
    },
    TEST_TIMEOUT_MS,
  );
});
