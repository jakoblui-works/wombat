// A tab with unsaved work asks before it closes: the question a panel registers under its tab's key (the key
// `useCloseGuard` makes) is found when the user closes the tab.
import { expect, test } from "vitest";

import "./activities.ts";
import { ITEM_PANEL } from "./items/item-params.ts";
import { closeGuards, tabKey } from "./tabs.ts";

test.each([
  { what: "an item's tab", params: { ws: "ws-tasks00001", binderId: "tasks", itemId: "0196f3c2-3e00-7000-8000-000000000001" } },
  { what: "a draft's tab", params: { ws: "ws-tasks00001", binderId: "tasks", draft: "draft-1", context: { status: "todo", parent: { id: "0196f3c2-3e00-7000-8000-000000000002", handle: "TSK-2" } } } },
])("$what asks before closing while its panel guards it, and closes once it doesn't", ({ params }) => {
  const guards = closeGuards();
  let asked = 0;
  let closed = 0;
  const close = () => {
    closed += 1;
  };
  // As useCloseGuard registers it, from the tab's panel and params as the panel was given them.
  const unguard = guards.guard(tabKey(ITEM_PANEL, structuredClone(params)), () => {
    asked += 1;
  });
  // As the strip's close asks, from the tab's entry in the shell state.
  guards.request(tabKey(ITEM_PANEL, params), close);
  expect({ asked, closed }, "a guarded close asks instead of closing").toEqual({ asked: 1, closed: 0 });

  unguard();
  guards.request(tabKey(ITEM_PANEL, params), close);
  expect({ asked, closed }, "an unguarded close closes").toEqual({ asked: 1, closed: 1 });
});
