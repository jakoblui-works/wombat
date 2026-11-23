// What "needs me" lists: every pending permission of a waiting agent, a row for a
// waiting agent without one; nothing for an agent that no longer waits. Needs me's rows order them (allRows).
import fc from "fast-check";
import { expect, test } from "vitest";

import type { AgentSummary } from "@wombat/shared/api";
import { ProposalStatus } from "@wombat/shared/proposals";

import { atFor } from "../../../../../shared/test/log-entries.ts";
import { proposal, summary } from "../../../../test/summaries.ts";
import { needsMeRows } from "../workbench/panels/NeedsMe/needs-me-rows.ts";
import { proposalRows } from "../workbench/panels/NeedsMe/proposal-rows.ts";
import { needsMe, needsMeCount } from "./needs-me.ts";

const pending = (requestId: string, at: string, title: string) => ({ requestId, at, title, kind: "edit" as const });

test("rows for waiting agents only, one per pending permission or one for the agent", () => {
  const agents = [
    summary("agent-c", { state: "waiting", pendingPermissions: [pending("r1", atFor(10), "Edit notes.txt"), pending("r2", atFor(30), "Run npm test")] }),
    summary("agent-b", { state: "waiting", lastActivityAt: atFor(20) }),
    summary("agent-a", { state: "waiting", lastActivityAt: atFor(30) }),
    // Not waiting: a stale pending row or none, never listed.
    summary("agent-d", { state: "working", pendingPermissions: [pending("r9", atFor(40), "Edit hours.md")] }),
    summary("agent-e", { state: "done", lastActivityAt: atFor(50) }),
  ];
  const listed = needsMe(agents);
  expect(listed).toHaveLength(4);
  expect(listed).toEqual(
    expect.arrayContaining([
      { agentId: "agent-a", at: atFor(30) },
      { agentId: "agent-c", requestId: "r2", title: "Run npm test", at: atFor(30) },
      { agentId: "agent-b", at: atFor(20) },
      { agentId: "agent-c", requestId: "r1", title: "Edit notes.txt", at: atFor(10) },
    ]),
  );

  // Answered and back to work: the rows clear with the summary.
  expect(needsMe([summary("agent-c", { state: "working" }), summary("agent-b", { state: "done" })])).toEqual([]);
  expect(needsMe([])).toEqual([]);
});

// The title bar and the sidebar header show the count; the sidebar lists the rows. They must never disagree.
test("the count is the request rows plus the proposal rows, for any agents and proposals in any status", () => {
  const states: AgentSummary["state"][] = ["working", "waiting", "done", "error", "stopped"];
  const agent = fc.record({
    state: fc.constantFrom(...states),
    requests: fc.nat({ max: 3 }),
    at: fc.nat({ max: 50 }),
  });
  const proposed = fc.record({ status: fc.constantFrom(...ProposalStatus.options), at: fc.nat({ max: 50 }), agent: fc.nat({ max: 4 }) });
  fc.assert(
    fc.property(fc.array(agent, { maxLength: 5 }), fc.array(proposed, { maxLength: 8 }), (agentSpecs, proposalSpecs) => {
      const agents = agentSpecs.map(({ state, requests, at }, i) =>
        summary(`agent-${String(i)}`, {
          state,
          lastActivityAt: atFor(at),
          pendingPermissions: Array.from({ length: requests }, (_, r) => pending(`r${String(r)}`, atFor(at + r), "Edit notes.txt")),
        }),
      );
      const proposals = proposalSpecs.map(({ status, at, agent: owner }, i) => ({ ...proposal(`proposal-${String(i)}`, `agent-${String(owner)}`), status, at: atFor(at) }));
      const now = Date.parse(atFor(100));
      expect(needsMeCount(agents, proposals)).toBe(needsMeRows(agents, now).length + proposalRows(proposals, agents, now).length);
    }),
  );
});
