import type { AgentSummary } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { groupAgents } from "./group-agents.ts";

const agent = (id: string, state: AgentSummary["state"], lastActivityAt: string): AgentSummary => ({
  id,
  harness: "fake",
  repo: ".",
  state,
  sessionId: "s",
  capabilities: { loadSession: false },
  startedAt: "2026-03-10T10:00:00.000Z",
  lastActivityAt,
  pendingPermissions: [],
  hasProcess: false,
});

test("groups follow the list's order, stopped agents sit in Done, newest first, empty groups are left out", () => {
  const groups = groupAgents([
    agent("a", "done", "2026-03-10T11:00:00.000Z"),
    agent("b", "stopped", "2026-03-10T11:30:00.000Z"),
    agent("c", "waiting", "2026-03-10T11:00:00.000Z"),
    agent("d", "done", "2026-03-10T11:10:00.000Z"),
  ]);
  expect(groups.map(({ state, agents }) => [state, agents.map(({ id }) => id)])).toEqual([
    ["waiting", ["c"]],
    ["done", ["b", "d", "a"]],
  ]);
});
