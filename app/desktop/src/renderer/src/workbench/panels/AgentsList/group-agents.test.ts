// The overview's grouping: a group for each listed workspace, holding its agents in the state order the overview
// promises (what needs me first). The order comes from the shared agent-state ranks, which other views read too.
import fc from "fast-check";
import { expect, test } from "vitest";

import type { AgentSummary, Workspace } from "@wombat/shared/api";

import { summary } from "../../../../../../test/summaries.ts";
import { groupAgents } from "./group-agents.ts";

type State = AgentSummary["state"];

/** The overview's order inside a workspace. */
const RULE: readonly State[] = ["waiting", "working", "error", "done", "stopped"];
const rank = (state: State): number => RULE.indexOf(state);

// Invented workspaces.
const workspace = (n: number, missing: boolean): Workspace => ({
  id: `ws-plot${String(n).padStart(4, "0")}`,
  name: `plot-${String(n)}`,
  root: `/home/someone/plots/plot-${String(n)}`,
  missing,
});

test("the overview gives every listed workspace exactly one group holding exactly its agents, empty ones too, ordered by state inside each", () => {
  const listedArb = fc.uniqueArray(fc.record({ n: fc.integer({ min: 1, max: 9 }), missing: fc.boolean() }), { minLength: 1, maxLength: 4, selector: ({ n }) => n });
  const agentArb = fc.record({ ws: fc.nat(), state: fc.constantFrom(...RULE), at: fc.nat({ max: 59 }), started: fc.nat({ max: 59 }) });
  fc.assert(
    fc.property(listedArb, fc.array(agentArb, { maxLength: 14 }), (listedSpecs, specs) => {
      const listed = listedSpecs.map(({ n, missing }) => workspace(n, missing));
      const agents = specs.map(({ ws, state, at, started }, i) =>
        summary(`agent-${String(i).padStart(2, "0")}`, {
          workspace: listed[ws % listed.length]!.id,
          state,
          startedAt: `2026-03-02T09:00:${String(started).padStart(2, "0")}.000Z`,
          lastActivityAt: `2026-03-02T10:00:${String(at).padStart(2, "0")}.000Z`,
        }),
      );
      const groups = groupAgents(agents, listed);

      // One group per listed workspace, none twice, none for anything else.
      expect(groups.map(({ workspace: { id } }) => id).sort()).toEqual(listed.map(({ id }) => id).sort());
      for (const group of groups) {
        const ids = group.agents.map(({ id }) => id);
        expect(ids.sort()).toEqual(agents.filter((agent) => agent.workspace === group.workspace.id).map(({ id }) => id).sort());
        const states = group.agents.map(({ state }) => state);
        expect(states).toEqual([...states].sort((a, b) => rank(a) - rank(b)));
      }
    }),
  );
});
