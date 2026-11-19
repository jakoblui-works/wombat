// A tab with unsaved work asks before it closes: the question a panel registers under its tab's key (the key
// `useCloseGuard` makes) is found when the user closes the tab `openTab` opened.
import type { IDockviewPanel } from "dockview-react";
import { expect, test } from "vitest";

import "./activities.ts";
import { ITEM_PANEL } from "./panels/Item/item-params.ts";
import { closeGuards, openTab, type TabHost, tabKey } from "./tabs.ts";

/** Just enough of dockview for openTab and a close: the panels it added, by id, and the ones removed. */
const fakeHost = () => {
  const panels = new Map<string, IDockviewPanel>();
  const removed: string[] = [];
  const host = {
    groups: [],
    activeGroup: undefined,
    getPanel: (id: string) => panels.get(id),
    addPanel: (options: { id: string; params?: unknown }) => {
      const panel = { id: options.id, params: options.params, api: { setActive: () => undefined } } as unknown as IDockviewPanel;
      panels.set(options.id, panel);
      return panel;
    },
    removePanel: (panel: IDockviewPanel) => {
      removed.push(panel.id);
      panels.delete(panel.id);
    },
  } as unknown as TabHost;
  return { host, panels, removed };
};

test.each([
  { what: "an item's tab", params: { binderId: "tasks", itemId: "0196f3c2-3e00-7000-8000-000000000001" } },
  { what: "a draft's tab", params: { binderId: "tasks", draft: "draft-1", context: { status: "todo", parent: { id: "0196f3c2-3e00-7000-8000-000000000002", handle: "TSK-2" } } } },
])("$what asks before closing while its panel guards it, and closes once it doesn't", ({ params }) => {
  const { host, panels, removed } = fakeHost();
  openTab(host, ITEM_PANEL, params);
  const [panel] = [...panels.values()];
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
