// T9: whether a saved tab still applies is the registry's to say (`isKnown(ctx)`: the view is registered, its
// paramsSchema passes, its resolves is true), and for a chat tab that's what lets a restore drop a deleted agent's
// tab (lasting check "Layout restore drops what's gone"). While the agents are still loading, a tab is kept.
import { expect, test } from "vitest";

import { summary } from "../../../../test/summaries.ts";
import "./activities.ts";
import { isKnown, type ResolveContext } from "./registry.ts";

test.each<[string, string, unknown, ResolveContext, boolean]>([
  ["a chat tab whose agent exists", "chat", { agentId: "a1" }, { agents: [summary("a1"), summary("a2")] }, true],
  ["a chat tab whose agent was deleted", "chat", { agentId: "a-gone" }, { agents: [summary("a1")] }, false],
  ["a chat tab while the agents are still loading", "chat", { agentId: "a1" }, { agents: undefined }, true],
  ["a view that isn't registered", "old-view-from-a-newer-app", {}, { agents: [summary("a1")] }, false],
])("%s", (_name, viewId, params, ctx, expected) => {
  expect(isKnown(ctx)(viewId, params)).toBe(expected);
});
