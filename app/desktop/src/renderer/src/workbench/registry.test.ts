// T9: whether a saved tab still applies is the registry's to say (`isKnown(ctx)`: the view is registered, its
// paramsSchema passes, its resolves is true), and for a chat tab that's what lets a restore drop a deleted agent's
// tab (lasting check "Layout restore drops what's gone"). While the agents are still loading, a tab is kept.
import { Circle } from "lucide-react";
import { expect, test } from "vitest";
import { z } from "zod";

import { summary } from "../../../../test/summaries.ts";
import "./activities.ts";
import { activities, getView, isKnown, registerView, type ResolveContext } from "./registry.ts";

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

// S4 fix round: "keep a tab while the agents list is unknown" is isKnown's rule; a view's resolves only ever sees a
// known list.
test("while the agents list is unknown a tab is kept without asking its view", () => {
  registerView({
    id: "test-needs-a-list",
    title: "Needs a list",
    icon: Circle,
    locations: ["editor"],
    component: () => null,
    // Throws on an unknown list, as a view written to the rule may.
    resolves: (_params, { agents }) => (agents as unknown[]).length > 0,
  });
  expect(isKnown({ agents: undefined })("test-needs-a-list", {})).toBe(true);
  expect(isKnown({ agents: [] })("test-needs-a-list", {})).toBe(false);
});

// Another agent, with a title and a repo of its own, is listed first: the tab's title is its own agent's.
const listedFirst = summary("9c0d1e2f-0000-4a4a-8b8b-112233445566", { title: "Fix the till", repo: "till-app" });

test.each<[string, ResolveContext, (id: string, title: string) => boolean]>([
  ["the agent's title", { agents: [listedFirst, summary("3f2a9c1e-77aa-4b1e-9e0d-5c3b2a1f0e9d", { title: "Opening hours" })] }, (_id, title) => title === "Opening hours"],
  ["else its repo", { agents: [listedFirst, summary("3f2a9c1e-77aa-4b1e-9e0d-5c3b2a1f0e9d", { repo: "bakery-site" })] }, (_id, title) => title === "bakery-site"],
  ["else a short id", { agents: [] }, (id, title) => title.length > 0 && title.length < id.length && id.includes(title)],
  ["else a short id, while the agents load", { agents: undefined }, (id, title) => title.length > 0 && title.length < id.length && id.includes(title)],
])("a chat tab's title: %s", (_name, ctx, fits) => {
  const agentId = "3f2a9c1e-77aa-4b1e-9e0d-5c3b2a1f0e9d";
  const title = getView("chat")?.title;
  const text = typeof title === "function" ? title({ agentId }, ctx) : title;
  expect(fits(agentId, text ?? ""), `title: ${String(text)}`).toBe(true);
});
