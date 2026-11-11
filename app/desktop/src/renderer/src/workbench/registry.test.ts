// T9: whether a saved tab still applies is the registry's to say (`isKnown(ctx)`: the view is registered, its
// paramsSchema passes, its resolves is true), and for a chat tab that's what lets a restore drop a deleted agent's
// tab (lasting check "Layout restore drops what's gone"). While the agents are still loading, a tab is kept.
import { Circle } from "lucide-react";
import { expect, test } from "vitest";
import { z } from "zod";

import { summary } from "../../../../test/log-entries.ts";
import "./activities.ts";
import { activities, isKnown, registerView, type ResolveContext } from "./registry.ts";

test.each<[string, string, unknown, ResolveContext, boolean]>([
  ["a chat tab whose agent exists", "chat", { agentId: "a1" }, { agents: [summary("a1"), summary("a2")] }, true],
  ["a chat tab whose agent was deleted", "chat", { agentId: "a-gone" }, { agents: [summary("a1")] }, false],
  ["a chat tab with no agents at all", "chat", { agentId: "a1" }, { agents: [] }, false],
  ["a chat tab while the agents are still loading", "chat", { agentId: "a1" }, { agents: undefined }, true],
  ["a chat tab without an agent", "chat", {}, { agents: [summary("a1")] }, false],
  ["a chat tab whose agent id isn't a string", "chat", { agentId: 7 }, { agents: [summary("a1")] }, false],
  ["a view that isn't registered", "old-view-from-a-newer-app", {}, { agents: [summary("a1")] }, false],
])("%s", (_name, viewId, params, ctx, expected) => {
  expect(isKnown(ctx)(viewId, params)).toBe(expected);
});

test("the five activities, in order", () => {
  expect(activities().map((activity) => activity.title)).toEqual(["Agents", "Files", "Source control", "Workspace", "Project overview"]);
});

// A view whose only check is its paramsSchema (no resolves of its own), so the schema step is isKnown's alone.
test("a tab whose params fail its view's paramsSchema doesn't apply", () => {
  registerView({
    id: "test-schema-only",
    title: "Schema only",
    icon: Circle,
    locations: ["editor"],
    component: () => null,
    paramsSchema: z.object({ path: z.string() }),
  });
  const known = isKnown({ agents: [] });
  expect(known("test-schema-only", { path: "hours.md" })).toBe(true);
  expect(known("test-schema-only", { path: 7 })).toBe(false);
});
