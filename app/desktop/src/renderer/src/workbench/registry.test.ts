// Whether a saved tab still applies is the registry's to say (`isKnown(ctx)`: the view is registered, its
// paramsSchema passes, its resolves is true), and for a chat tab that's what lets a restore drop a deleted agent's
// tab. While the agents are still loading, a tab is kept.
import { expect, test } from "vitest";

import { proposal, summary } from "../../../../test/summaries.ts";
import "./activities.ts";
import { isKnown, isRestorable, type ResolveContext } from "./registry.ts";
import { PROPOSAL_VIEW } from "./views/Proposal/proposal-params.ts";

test.each<[string, string, unknown, ResolveContext, boolean]>([
  ["a chat tab whose agent exists", "chat", { agentId: "a1" }, { agents: [summary("a1"), summary("a2")] }, true],
  ["a chat tab whose agent was deleted", "chat", { agentId: "a-gone" }, { agents: [summary("a1")] }, false],
  ["a chat tab while the agents are still loading", "chat", { agentId: "a1" }, { agents: undefined }, true],
  ["a view that isn't registered", "old-view-from-a-newer-app", {}, { agents: [summary("a1")] }, false],
])("%s", (_name, viewId, params, ctx, expected) => {
  expect(isKnown(ctx)(viewId, params)).toBe(expected);
});

// A proposal tab stays while its proposal is listed (a decided one shows its outcome) and comes back at the next start
// only while it's open. Until the proposals are read, nothing is known, so the tab is kept and restored.
test("a proposal tab is kept while its proposal is listed or unknown, and restored only while it's open or unknown", () => {
  const agents = [summary("a1")];
  const proposals = [proposal("p-open", "a1"), { ...proposal("p-decided", "a1"), status: "approved" as const }];
  const tab = (proposalId: string, ctx: ResolveContext) => ({
    kept: isKnown(ctx)(PROPOSAL_VIEW, { proposalId }),
    restored: isRestorable(ctx)(PROPOSAL_VIEW, { proposalId }),
  });

  expect(tab("p-open", { agents, proposals: undefined }), "proposals not read yet").toEqual({ kept: true, restored: true });
  expect(tab("p-open", { agents, proposals }), "open").toEqual({ kept: true, restored: true });
  expect(tab("p-decided", { agents, proposals }), "decided").toEqual({ kept: true, restored: false });
  expect(tab("p-gone", { agents, proposals }), "no longer listed").toEqual({ kept: false, restored: false });
});
