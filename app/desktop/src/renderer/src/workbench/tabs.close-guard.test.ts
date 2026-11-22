// A tab with unsaved work asks before it closes: the question a panel registers under its tab's key (the key
// `useCloseGuard` makes) is found when the user closes the tab `openTab` opened. And a temporary tab never takes the
// place of one with unsaved work or a kept one, and no group ever holds two temporary tabs, however tabs are opened,
// edited, saved, moved and closed.
import type { IDockviewPanel } from "dockview-react";
import fc from "fast-check";
import { expect, test } from "vitest";

import "./activities.ts";
import { ITEM_PANEL } from "./panels/Item/item-params.ts";
import { closeGuards, isTemporaryTab, keepAllTabs, openTab, settleMovedTab, type TabHost, tabKey, tabToReplace } from "./tabs.ts";

type FakeGroup = { id: string; panels: FakePanel[] };
type FakePanel = { id: string; params: unknown; group: FakeGroup; api: { setActive: () => void } };
type Position = { referenceGroup?: FakeGroup | string; index?: number };

/**
 * Just enough of dockview for openTab, a close and a move: `groupCount` groups of panels, the active one where a tab
 * opens, and the ids of the panels removed. `move` puts a tab at the end of another group and settles it as the
 * workbench does on dockview's move event.
 */
const fakeHost = (groupCount = 1) => {
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

test.each([
  { what: "an item's tab", params: { binderId: "tasks", itemId: "0196f3c2-3e00-7000-8000-000000000001" } },
  { what: "a draft's tab", params: { binderId: "tasks", draft: "draft-1", context: { status: "todo", parent: { id: "0196f3c2-3e00-7000-8000-000000000002", handle: "TSK-2" } } } },
])("$what asks before closing while its panel guards it, and closes once it doesn't", ({ params }) => {
  const { host, panels, removed } = fakeHost();
  openTab(host, ITEM_PANEL, params);
  const [panel] = panels() as unknown as IDockviewPanel[];
  if (panel === undefined) throw new Error("openTab opened no tab");

  const guards = closeGuards();
  let asked = 0;
  // As useCloseGuard registers it, from the tab's panel and params as the panel was given them.
  const unguard = guards.guard(tabKey(ITEM_PANEL, structuredClone(params)), () => {
    asked += 1;
  });
  guards.close(host, panel);
  expect({ asked, removed }, "a guarded close asks instead of closing").toEqual({ asked: 1, removed: [] });

  unguard();
  guards.close(host, panel);
  expect({ asked, removed }, "an unguarded close closes").toEqual({ asked: 1, removed: [panel.id] });
});

test("the tab a temporary tab replaces never has unsaved edits, whatever else in the group is temporary", () => {
  const tabsArb = fc.uniqueArray(fc.record({ key: fc.string({ minLength: 1, maxLength: 4 }), temporary: fc.boolean(), unsaved: fc.boolean() }), { selector: ({ key }) => key, maxLength: 6 });
  fc.assert(
    fc.property(tabsArb, (tabs) => {
      const replaced = tabToReplace(tabs);
      if (replaced === undefined) return;
      expect(tabs.find(({ key }) => key === replaced), `${replaced} among ${JSON.stringify(tabs)}`).toMatchObject({ temporary: true, unsaved: false });
    }),
    { numRuns: 300 },
  );
});

const GROUPS = 3;
const ITEMS = 5;
const itemTab = (n: number) => ({ binderId: "chores", itemId: `0196f3c2-5a00-7000-8000-${n.toString(16).padStart(12, "0")}` });

type Step =
  | { kind: "open"; n: number; group: number; temporary: boolean }
  | { kind: "edit" | "save" | "close"; n: number }
  | { kind: "move"; n: number; group: number };

const item = fc.nat({ max: ITEMS - 1 });
const group = fc.nat({ max: GROUPS - 1 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("open" as const), n: item, group, temporary: fc.boolean() }),
  fc.record({ kind: fc.constantFrom("edit" as const, "save" as const, "close" as const), n: item }),
  fc.record({ kind: fc.constant("move" as const), n: item, group }),
);

test("a temporary tab never replaces a kept or unsaved tab, and no group ever holds two temporary tabs", () => {
  fc.assert(
    fc.property(fc.array(stepArb, { maxLength: 30 }), (steps) => {
      const { host, groups, removed, panels, focus, move } = fakeHost(GROUPS);
      const guards = closeGuards();
      // As an item tab's useCloseGuard does while it holds unsaved edits.
      const unguards = new Map<string, () => void>();
      try {
        for (const step of steps) {
          const key = tabKey(ITEM_PANEL, itemTab(step.n));
          const open = panels().find(({ id }) => id === key);
          const replaceable = new Set(panels().flatMap(({ id }) => (isTemporaryTab(id) && !guards.unsaved(id) ? [id] : [])));
          removed.length = 0;
          switch (step.kind) {
            case "open":
              focus(step.group);
              openTab(host, ITEM_PANEL, itemTab(step.n), undefined, { temporary: step.temporary });
              expect(panels().map(({ id }) => id), "the opened tab shows").toContain(key);
              expect(removed.filter((id) => !replaceable.has(id)), `${JSON.stringify(step)} closed no kept or unsaved tab`).toEqual([]);
              break;
            case "edit":
              if (open !== undefined && !unguards.has(key)) unguards.set(key, guards.guard(key, () => undefined));
              break;
            case "save":
              unguards.get(key)?.();
              unguards.delete(key);
              break;
            case "close":
              if (open !== undefined) guards.close(host, open as unknown as IDockviewPanel);
              break;
            case "move":
              move(key, step.group);
              break;
          }
          for (const each of groups) {
            const temporary = each.panels.filter(({ id }) => isTemporaryTab(id)).map(({ id }) => id);
            expect(temporary.length, `temporary tabs in ${each.id} after ${JSON.stringify(step)}: ${temporary.join(", ")}`).toBeLessThanOrEqual(1);
          }
        }
      } finally {
        for (const unguard of unguards.values()) unguard();
        keepAllTabs();
      }
    }),
    { numRuns: 300 },
  );
});
