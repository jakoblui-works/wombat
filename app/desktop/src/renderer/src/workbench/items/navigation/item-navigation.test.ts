import fc from "fast-check";
import { expect, test } from "vitest";

import { fakeHost, item, itemTab } from "../../../../../../test/fake-tab-host.ts";
import "../../activities.ts";
import { keepAllTabs, openTab, tabKey } from "../../tabs.ts";
import { ITEM_PANEL } from "../item-params.ts";
import { itemTabs } from "./item-navigation.ts";

test("an item's tabs are found by its id, whichever binder they were opened from, and no draft's or other item's tab", () => {
  const binderArb = fc.constantFrom("tasks", "archive", "notes", "chores");
  // Item tabs, each showing item 0..ITEMS-1 as opened from some binder; draft tabs, from some binder.
  const openArb = fc.array(fc.oneof(fc.record({ n: item, binderId: binderArb }), fc.record({ draft: fc.nat({ max: 3 }), binderId: binderArb })), { maxLength: 12 });
  fc.assert(
    fc.property(openArb, item, (opened, wanted) => {
      const { host } = fakeHost();
      try {
        const showing = new Set<string>();
        for (const each of opened) {
          const params = "n" in each ? { ...itemTab(each.n), binderId: each.binderId } : { binderId: each.binderId, draft: `draft-${String(each.draft)}`, context: {} };
          openTab(host, ITEM_PANEL, params);
          if ("n" in each && each.n === wanted) showing.add(tabKey(ITEM_PANEL, params));
        }
        const found = itemTabs({ workbench: { host } }, itemTab(wanted).itemId).map((tab) => tabKey(tab.panelId, tab.params));
        expect(new Set(found), `item ${String(wanted)} among ${JSON.stringify(opened)}`).toEqual(showing);
      } finally {
        keepAllTabs();
      }
    }),
    { numRuns: 300 },
  );
});
