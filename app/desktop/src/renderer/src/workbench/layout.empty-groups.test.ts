// An empty group is where the next thing opens, so a saved layout keeps it. Restoring drops the tabs that no longer
// apply and the groups that leaves empty, but a group that was saved empty is the user's own and stays, wherever it
// sits in the grid.
import type { SerializedDockview } from "dockview-react";
import { expect, test } from "vitest";

import "./activities.ts";
import { type IsKnown, pruneLayout, SavedLayout } from "./layout.ts";
import { activities } from "./registry.ts";

type Leaf = { type: "leaf"; data: { id: string; views: string[]; activeView?: string }; size: number };
type Branch = { type: "branch"; data: (Leaf | Branch)[]; size: number };
type Panel = { id: string; contentComponent: string; title: string; params: { viewId: string; params: unknown } };

const panel = (viewId: string, params: Record<string, unknown>): Panel => ({
  id: `${viewId}:${JSON.stringify(params)}`,
  contentComponent: "view",
  title: viewId,
  params: { viewId, params },
});
const leaf = (id: string, panels: Panel[]): Leaf => ({
  type: "leaf",
  data: { id, views: panels.map((p) => p.id), ...(panels[0] === undefined ? {} : { activeView: panels[0].id }) },
  size: 400,
});
const branch = (...data: (Leaf | Branch)[]): Branch => ({ type: "branch", data, size: 400 });

const saved = (root: Branch, panels: Panel[], activeGroup: string): SavedLayout => ({
  version: 1,
  dockview: {
    grid: { root, width: 1200, height: 800, orientation: "HORIZONTAL" },
    panels: Object.fromEntries(panels.map((p) => [p.id, p])),
    activeGroup,
  } as unknown as SerializedDockview,
  sidebars: { left: 250, right: 300, rightCollapsed: false },
  activity: activities()[0]?.id ?? "missing",
});

const leaves = (node: Leaf | Branch): Leaf[] => (node.type === "leaf" ? [node] : node.data.flatMap(leaves));
const groupIds = (layout: SavedLayout): string[] => leaves(layout.dockview.grid.root as unknown as Branch).map((g) => g.data.id).sort();

// Invented agents: a1 still exists, a-gone was deleted since the layout was saved.
const kept = panel("chat", { agentId: "a1" });
const gone = panel("chat", { agentId: "a-gone" });
const known: IsKnown = (_viewId, params) => (params as { agentId?: string }).agentId === "a1";

test.each<[string, Branch, Panel[], string, string[]]>([
  ["while pruning empties and removes another group", branch(leaf("empty", []), leaf("emptied", [gone]), leaf("tabs", [kept])), [kept, gone], "emptied", ["empty", "tabs"]],
])("a group saved empty stays through a restore: %s", (_what, root, panels, activeGroup, groupsAfter) => {
  const pruned = pruneLayout(saved(root, panels, activeGroup), known);
  expect(groupIds(pruned)).toEqual(groupsAfter);
  const active = pruned.dockview.activeGroup;
  if (active !== undefined) expect(groupsAfter).toContain(active);
  if (groupsAfter.includes(activeGroup)) expect(active).toBe(activeGroup);
  expect(SavedLayout.safeParse(pruned).success).toBe(true);
});
