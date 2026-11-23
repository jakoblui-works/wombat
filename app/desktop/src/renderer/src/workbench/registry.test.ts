// Whether a saved tab still applies is the registry's to say (`isKnown(ctx)`: the panel is registered, its
// paramsSchema passes, its resolves is true), and for a diff tab that's what lets a restore drop a deleted agent's
// tab. While the agents are still loading, a tab is kept.
import { expect, test } from "vitest";

import { proposal, summary } from "../../../../test/summaries.ts";
import "./activities.ts";
import { isKnown, isRestorable, type ResolveContext } from "./registry.ts";
import { PROPOSAL_PANEL } from "./proposals/proposal-params.ts";

test.each<[string, string, unknown, ResolveContext, boolean]>([
  ["a diff tab whose agent exists", "diff", { agentId: "a1", requestId: "r1" }, { agents: [summary("a1"), summary("a2")] }, true],
  ["a diff tab whose agent was deleted", "diff", { agentId: "a-gone", requestId: "r1" }, { agents: [summary("a1")] }, false],
  ["a diff tab while the agents are still loading", "diff", { agentId: "a1", requestId: "r1" }, { agents: undefined }, true],
  ["a panel that isn't registered", "old-panel-from-a-newer-app", {}, { agents: [summary("a1")] }, false],
])("%s", (_name, panelId, params, ctx, expected) => {
  expect(isKnown(ctx)(panelId, params)).toBe(expected);
});

// A proposal tab stays while its proposal is listed (a decided one shows its outcome) and comes back at the next start
// only while it's open. Until the proposals are read, nothing is known, so the tab is kept and restored.
test("a proposal tab is kept while its proposal is listed or unknown, and restored only while it's open or unknown", () => {
  const agents = [summary("a1")];
  const proposals = [proposal("p-open", "a1"), { ...proposal("p-decided", "a1"), status: "approved" as const }];
  const tab = (proposalId: string, ctx: ResolveContext) => ({
    kept: isKnown(ctx)(PROPOSAL_PANEL, { proposalId }),
    restored: isRestorable(ctx)(PROPOSAL_PANEL, { proposalId }),
  });

  expect(tab("p-open", { agents, proposals: undefined }), "proposals not read yet").toEqual({ kept: true, restored: true });
  expect(tab("p-open", { agents, proposals }), "open").toEqual({ kept: true, restored: true });
  expect(tab("p-decided", { agents, proposals }), "decided").toEqual({ kept: true, restored: false });
  expect(tab("p-gone", { agents, proposals }), "no longer listed").toEqual({ kept: false, restored: false });
});
