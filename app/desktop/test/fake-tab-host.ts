import type { IDockviewPanel } from "dockview-react";
import fc from "fast-check";

import { settleMovedTab, type TabHost } from "../src/renderer/src/workbench/tabs.ts";

type FakeGroup = { id: string; panels: FakePanel[] };
type FakePanel = { id: string; params: unknown; group: FakeGroup; api: { setActive: () => void } };
type Position = { referenceGroup?: FakeGroup | string; index?: number };

/**
 * Just enough of dockview for openTab, a close and a move: `groupCount` groups of panels, the active one where a tab
 * opens, and the ids of the panels removed. `move` puts a tab at the end of another group and settles it as the
 * workbench does on dockview's move event.
 */
export const fakeHost = (groupCount = 1) => {
  const groups: FakeGroup[] = Array.from({ length: groupCount }, (_, at) => ({ id: `group-${String(at)}`, panels: [] }));
  let activeGroup = groups[0];
  const removed: string[] = [];
  const panels = (): FakePanel[] => groups.flatMap((group) => group.panels);
  const getPanel = (id: string): FakePanel | undefined => panels().find((panel) => panel.id === id);
  const detach = (panel: FakePanel): void => {
    panel.group.panels.splice(panel.group.panels.indexOf(panel), 1);
  };
  const host = {
    groups,
    get activeGroup() {
      return activeGroup;
    },
    get panels() {
      return panels();
    },
    getPanel,
    addPanel: ({ id, params, position }: { id: string; params?: unknown; position?: Position }) => {
      const reference = position?.referenceGroup;
      const group = (typeof reference === "string" ? groups.find((each) => each.id === reference) : reference) ?? activeGroup;
      if (group === undefined) throw new Error("the fake host has no group to add to");
      const panel: FakePanel = { id, params, group, api: { setActive: () => (activeGroup = panel.group) } };
      group.panels.splice(position?.index ?? group.panels.length, 0, panel);
      activeGroup = group;
      return panel;
    },
    removePanel: (panel: FakePanel) => {
      removed.push(panel.id);
      detach(panel);
    },
  } as unknown as TabHost;
  return {
    host,
    groups,
    removed,
    panels,
    focus: (at: number) => (activeGroup = groups[at]),
    move: (id: string, to: number) => {
      const panel = getPanel(id);
      const group = groups[to];
      if (panel === undefined || group === undefined) return;
      detach(panel);
      group.panels.push(panel);
      panel.group = group;
      activeGroup = group;
      settleMovedTab(panel as unknown as IDockviewPanel);
    },
  };
};

const ITEMS = 5;
export const itemTab = (n: number) => ({ ws: "ws-chores0001", binderId: "chores", itemId: `0196f3c2-5a00-7000-8000-${n.toString(16).padStart(12, "0")}` });
export const item = fc.nat({ max: ITEMS - 1 });
