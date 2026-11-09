// Each agent runs in its own systemd user scope in the service's slice, so stop, delete and
// shutdown kill everything it started, helpers outside its process group or session included. Fake systemd
// tools record their calls (CI-safe); the last test uses the real user manager and is skipped where there's none.
import { spawnSync } from "node:child_process";

import { describe, expect, onTestFinished, test } from "vitest";

import { killedUnits, option, runs, sliceStops, type FakeSystemd } from "../../test/fake-systemd.ts";
import { childPidOf, isAlive, REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";

const unitOf = (agentId: string) => `wombat-agent-${agentId}.scope`;

const fakesOf = (t: Setup): FakeSystemd => {
  if (!t.systemd) throw new Error("this test needs setup({ systemd: \"fake\" })");
  return t.systemd;
};

const warnings = (t: Setup, event: string) => t.logs.filter((line) => line.event === event);

describe("agents in scopes (fake systemd)", () => {
  test(
    "agents start as wombat-agent-<id>.scope in the configured slice, no scope_unavailable; stop and delete each kill exactly that unit, two agents running",
    async () => {
      const t = setup({ systemd: "fake" });
      const fakes = fakesOf(t);
      const one = await t.manager.start("fake-reply", REPO);
      const two = await t.manager.start("fake-reply", REPO);

      const started = runs(fakes.calls());
      expect(started.map((run) => option(run.options, "unit")).sort()).toEqual([unitOf(one.id), unitOf(two.id)].sort());
      expect(started.every((run) => option(run.options, "slice") === t.slice)).toBe(true);
      expect(warnings(t, "scope_unavailable")).toEqual([]);

      await t.manager.stop(one.id);
      expect(t.agent(one.id)?.state).toBe("stopped");
      await waitFor("the first agent's scope killed", () => killedUnits(fakes.calls()).includes(unitOf(one.id)));
      expect(killedUnits(fakes.calls())).toEqual([unitOf(one.id)]);

      await t.manager.delete(two.id);
      expect(t.store.listAgents().map((agent) => agent.id)).toEqual([one.id]);
      await waitFor("the second agent's scope killed", () => killedUnits(fakes.calls()).includes(unitOf(two.id)));
      expect(killedUnits(fakes.calls()).sort()).toEqual([unitOf(one.id), unitOf(two.id)].sort());
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "when systemd is there but systemd-run can't start the scope, start fails with agent_failed and nothing runs uncontained",
    async () => {
      const t = setup({ systemd: "fake", fake: { runFails: true } });
      await expect(t.manager.start("fake-reply", REPO)).rejects.toMatchObject({ code: "agent_failed" });
      expect(runs(fakesOf(t).calls()).length).toBeGreaterThan(0);
      expect(t.store.listAgents()).toEqual([]);
      // The fake agent records its pid as it starts: none means it never ran, scoped or not.
      expect(t.pids()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "shutdown kills every running agent's scope and stops the slice",
    async () => {
      const t = setup({ systemd: "fake" });
      const fakes = fakesOf(t);
      const one = await t.manager.start("fake-reply", REPO);
      const two = await t.manager.start("fake-reply", REPO);

      await t.manager.shutdown();
      await waitFor(
        "both scopes killed and the slice stopped",
        () =>
          [unitOf(one.id), unitOf(two.id)].every((unit) => killedUnits(fakes.calls()).includes(unit)) &&
          sliceStops(fakes.calls(), t.slice).length > 0,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test.each([
    { left: true, name: "a slice with something left from a previous service is stopped, with a warning" },
    { left: false, name: "an empty slice is left alone, with no warning" },
  ])(
    "at start-up, $name",
    async ({ left }) => {
      const t = setup({ systemd: "fake", fake: { sliceActive: left } });
      const fakes = fakesOf(t);
      const asked = () =>
        fakes.calls().some(({ tool, args }) => tool === "systemctl" && args.includes("is-active") && args.includes(t.slice));

      if (left) {
        await waitFor("the leftover slice stopped and warned about", () => {
          return sliceStops(fakes.calls(), t.slice).length > 0 && warnings(t, "scope_leftovers_stopped").length > 0;
        });
        expect(warnings(t, "scope_leftovers_stopped").map((line) => line.fields.slice)).toEqual([t.slice]);
      } else {
        await waitFor("the slice checked for leftovers", asked);
        // Time for a wrongful stop to show: an agent starts and runs a turn.
        const { id } = await t.manager.start("fake-reply", REPO);
        await t.manager.send(id, { text: "Hello" });
        await t.turnEnded(id);
        expect(sliceStops(fakes.calls(), t.slice)).toEqual([]);
        expect(warnings(t, "scope_leftovers_stopped")).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("detection", () => {
  test.each([
    { name: "no systemd tools on PATH", systemd: "none", state: undefined, scoped: false },
    { name: "the user manager can't be reached", systemd: "fake", state: "no-bus", scoped: false },
    { name: "the user manager is offline", systemd: "fake", state: "offline", scoped: false },
    { name: "a degraded user manager still answers", systemd: "fake", state: "degraded", scoped: true },
  ] as const)(
    "$name: scoped=$scoped; without scopes, agents run as process groups and every start warns scope_unavailable",
    async ({ systemd, state, scoped }) => {
      const t = setup(state === undefined ? { systemd } : { systemd, fake: { state } });
      const one = await t.manager.start("fake-reply", REPO);
      const two = await t.manager.start("fake-reply", REPO);
      await t.manager.send(two.id, { text: "Still answering?" });
      await t.turnEnded(two.id);

      const started = runs(t.systemd?.calls() ?? []);
      if (scoped) {
        expect(started.map((run) => option(run.options, "unit")).sort()).toEqual([unitOf(one.id), unitOf(two.id)].sort());
        expect(warnings(t, "scope_unavailable")).toEqual([]);
      } else {
        expect(started).toEqual([]);
        expect(warnings(t, "scope_unavailable")).toHaveLength(2);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/** Whether a real user manager answers here (as the service's detection would see it). */
const realSystemd = (() => {
  const run = spawnSync("systemctl", ["--user", "is-system-running"], { encoding: "utf8", timeout: 5_000 });
  const answer = run.stdout?.trim() ?? "";
  const hasRun = spawnSync("systemd-run", ["--version"], { stdio: "ignore", timeout: 5_000 }).status === 0;
  return run.error === undefined && answer !== "" && answer !== "offline" && hasRun;
})();

describe("real systemd", () => {
  test.skipIf(!realSystemd)(
    "stop kills a helper the agent started in a session of its own (setsid)",
    async () => {
      const t = setup({ systemd: "real" });
      // Node's `detached: true` runs the helper under setsid: out of the agent's process group and session.
      const { id } = await t.manager.start("fake-detached-holder", REPO);
      await t.manager.send(id, { text: "Start a background helper" });
      await t.turnEnded(id);
      const helperPid = childPidOf(t.items(id));
      onTestFinished(() => {
        try {
          process.kill(helperPid, "SIGKILL");
        } catch {
          // Gone, as it should be.
        }
      });
      expect(isAlive(helperPid)).toBe(true);

      await t.manager.stop(id);
      await waitFor("the setsid'd helper killed with the agent's scope", () => !isAlive(helperPid));
      expect(t.agent(id)?.state).toBe("stopped");
    },
    TEST_TIMEOUT_MS,
  );
});
