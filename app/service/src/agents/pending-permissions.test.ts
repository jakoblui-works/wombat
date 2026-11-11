// Lasting check (contract "AgentSummary additions", silent failure): an agent's `pendingPermissions` lists exactly
// its open permission requests. A request shows from the moment it's asked, and leaves the summary when it's
// answered, when the turn is cancelled, when the agent is stopped, when its process exits, and when the service
// restarts after dying with one open; an `agent_changed` alert follows each change, so the app refetches. Without
// it, Needs me would offer a request that no longer exists, and answering it would only ever fail.
import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";
import { summary } from "../../test/store-fixtures.ts";

type Requested = Extract<LogEntry, { type: "permission_requested" }>;
type Pending = AgentSummary["pendingPermissions"];

/**
 * Records, at each agent_changed alert, the agent's stored pendingPermissions: what the app would read if it
 * refetched on that alert.
 */
const announced = (t: Setup) => {
  const seen = new Map<string, Pending[]>();
  t.manager.onCommitted((event) => {
    if (event.type !== "agent_changed") return;
    const list = seen.get(event.agentId) ?? [];
    list.push(t.agent(event.agentId)?.pendingPermissions ?? []);
    seen.set(event.agentId, list);
  });
  return { last: (agentId: string) => seen.get(agentId)?.at(-1) };
};

/** Starts the permission scenario and waits until its request is open. */
const openRequest = async (t: Setup) => {
  const { id } = await t.manager.start("fake-permission", REPO);
  await t.manager.send(id, { text: "Edit the notes" });
  await waitFor("state waiting", () => t.agent(id)?.state === "waiting");
  const request = t.entries(id).find((entry): entry is Requested => entry.type === "permission_requested");
  if (!request) throw new Error("no permission_requested entry while waiting");
  return { id, request };
};

const killAgentProcesses = (t: Setup) => {
  for (const pid of t.pids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
};

// Each path ends the request; the summary is checked as soon as the call returns (or, for an exit, as soon as
// the state shows the exit), so a path that leaves the row for the turn's end to clear fails here.
const PATHS: { path: string; clear: (t: Setup, id: string, request: Requested) => Promise<void> }[] = [
  {
    path: "answered",
    clear: async (t, id, request) => {
      t.manager.answer(id, request.requestId, "allow_once");
      await Promise.resolve();
    },
  },
  { path: "turn cancelled", clear: (t, id) => t.manager.cancel(id) },
  { path: "agent stopped", clear: (t, id) => t.manager.stop(id) },
  {
    path: "agent process exited",
    clear: async (t, id) => {
      killAgentProcesses(t);
      await waitFor("the exit recorded", () => t.agent(id)?.state !== "waiting");
    },
  },
];

describe("pending permissions", () => {
  test.each(PATHS)(
    "an open request shows in pendingPermissions, leaves it when $path, and an agent_changed alert follows both",
    async ({ clear }) => {
      const t = setup();
      const alerts = announced(t);
      const { id, request } = await openRequest(t);

      // The request names its tool call by id only: title and kind come from the tool_call the agent sent before it.
      const open = [{ requestId: request.requestId, at: request.at, title: "Edit notes.txt", kind: "edit" }];
      expect(t.agent(id)?.pendingPermissions, "while the request is open").toEqual(open);
      expect(alerts.last(id), "the last agent_changed alert announced the open request").toEqual(open);

      await clear(t, id, request);

      expect(t.agent(id)?.pendingPermissions, "once the request is gone").toEqual([]);
      expect(alerts.last(id), "an agent_changed alert announced the cleared list").toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "several open requests: one row each, oldest first, named from the request, else the stored tool call, else \"\" and other; answering one leaves the others in order",
    async () => {
      const t = setup();
      const alerts = announced(t);
      const { id } = await t.manager.start("fake-permissions-three", REPO);
      await t.manager.send(id, { text: "Edit the notes and run the tests" });
      let requests: Requested[] = [];
      await waitFor("three open requests", () => {
        requests = t.entries(id).filter((entry): entry is Requested => entry.type === "permission_requested");
        return requests.length === 3;
      });
      const [stored, named, bare] = requests;
      if (!stored || !named || !bare) throw new Error("fewer than three requests");
      const row = (request: Requested, title: string, kind: string) => ({ requestId: request.requestId, at: request.at, title, kind });
      const all = [row(stored, "Edit notes.txt", "edit"), row(named, "Run the test suite", "execute"), row(bare, "", "other")];

      // Each row is written with its request's entry, so all three are in the summary by now.
      expect(t.agent(id)?.pendingPermissions).toEqual(all);
      expect(alerts.last(id)).toEqual(all);

      t.manager.answer(id, named.requestId, "allow_once");

      const left = [all[0], all[2]];
      expect(t.agent(id)?.pendingPermissions, "the answered one leaves; the others keep their order").toEqual(left);
      expect(alerts.last(id)).toEqual(left);

      await t.manager.cancel(id);

      expect(t.agent(id)?.pendingPermissions).toEqual([]);
      expect(alerts.last(id)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a summary stored with an open request by a service that died reads with none after the restart",
    async () => {
      const t = setup();
      const stale = summary("agent-left-waiting", {
        state: "waiting",
        pendingPermissions: [{ requestId: "perm-1", at: "2026-11-09T09:04:00.000Z", title: "Edit src/Footer.tsx", kind: "edit" }],
      });
      t.store.putAgent(stale);

      await t.restart();

      expect(t.agent(stale.id)?.state, "control: the restart did mark the agent").toBe("stopped");
      expect(t.agent(stale.id)?.pendingPermissions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
