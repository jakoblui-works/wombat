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

// The order the user sees: what needs me first. Stopped agents are finished, so they sit in Done.
const LIST_ORDER: AgentSummary["state"][] = ["waiting", "working", "done", "error"];

test("one group per state, waiting, working, done, error, stopped agents in Done, newest first within a group, empty groups left out", () => {
  const every = groupAgents([
    agent("e", "error", "2026-03-10T11:00:00.000Z"),
    agent("d1", "done", "2026-03-10T11:00:00.000Z"),
    agent("s", "stopped", "2026-03-10T11:30:00.000Z"),
    agent("wk", "working", "2026-03-10T11:00:00.000Z"),
    agent("d2", "done", "2026-03-10T11:10:00.000Z"),
    agent("wt", "waiting", "2026-03-10T11:00:00.000Z"),
  ]);
  const members: Record<string, string[]> = { waiting: ["wt"], working: ["wk"], done: ["s", "d2", "d1"], error: ["e"] };
  expect(every.map(({ state, agents }) => [state, agents.map(({ id }) => id)])).toEqual(LIST_ORDER.map((state) => [state, members[state]]));

  const some = groupAgents([agent("a", "done", "2026-03-10T11:00:00.000Z"), agent("b", "waiting", "2026-03-10T11:00:00.000Z")]);
  expect(some.map(({ state }) => state)).toEqual(LIST_ORDER.filter((state) => state === "waiting" || state === "done"));
});
