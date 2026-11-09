// Agent manager: starting (and failing to), commandId retries, stop, delete, start-up after a restart, and
// shutdown.
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { summary, textChunk } from "../../test/store-fixtures.ts";
import {
  childPidOf,
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
    "stop ends the agent's process group, state stopped, history kept; send is then not_running",
    async () => {
      const t = setup();
      const { id, agentPid, childPid } = await withChild(t);
      const history = t.entries(id);

      await t.manager.stop(id);
      expect(isAlive(agentPid)).toBe(false);
      await gone("the agent's process group", [agentPid, childPid], [agentPid]);
      expect(t.agent(id)?.state).toBe("stopped");
      expect(t.entries(id)).toEqual(history);
      await expect(t.manager.send(id, { text: "Still there?" })).rejects.toMatchObject({ code: "not_running" });
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
