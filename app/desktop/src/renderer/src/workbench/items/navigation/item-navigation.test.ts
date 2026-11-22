import fc from "fast-check";
import { afterEach, expect, test, vi } from "vitest";

import { ItemsErrorCode } from "@wombat/shared/api";
import type { Item } from "@wombat/shared/items";

import { fakeHost, item, itemTab } from "../../../../../../test/fake-tab-host.ts";
import { keys } from "../../../data/keys.ts";
import { createQueryClient } from "../../../data/query-client.ts";
import "../../activities.ts";
import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { DEFAULT_DESK, type DeskLayout } from "../../layout.ts";
import { keepAllTabs, openTab, openTabs, revealStore, tabKey, workbenchActions } from "../../tabs.ts";
import { previewName } from "../ItemPreview/item-preview.ts";
import { ITEM_PANEL } from "../item-params.ts";
import { itemNotFound } from "../reads.ts";
import { followItem, type ItemNavigator, itemTabs } from "./item-navigation.ts";

afterEach(() => {
  keepAllTabs();
  vi.unstubAllGlobals();
});

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

type Answer = { status: number; body: unknown };

// Invented items, each in a binder of its own.
const hive = (n: number): Item => ({
  id: `0196f3c2-7b00-7000-8000-${n.toString(16).padStart(12, "0")}`,
  handle: `HV-${String(n)}`,
  aliases: [],
  title: `Invented hive ${String(n)}`,
  body: "Check the frames.\n",
  properties: {},
  path: `apiary-${String(n)}/HV-${String(n)}.md`,
  version: "0".repeat(64),
  problems: [],
  excerpt: null,
  binder: `apiary-${String(n)}`,
});
const tabOf = (shown: Item) => ({ binderId: shown.binder, itemId: shown.id });

/** A page whose item reads the test answers itself, one ref at a time; the service lists no binders. */
const page = () => {
  const asked = new Map<string, (answer: Answer) => void>();
  const request = (_method: string, path: string): Promise<Answer> =>
    path === "/binders" ? Promise.resolve({ status: 200, body: { binders: [] } }) : new Promise((resolve) => asked.set(decodeURIComponent(path.replace("/items/", "")), resolve));
  vi.stubGlobal("window", { wombat: { service: { request } } });

  const { host } = fakeHost();
  const reveals = revealStore();
  const titleContext = () => ({ agents: [] });
  const shownActivities: string[] = [];
  const told: string[] = [];
  let desk: DeskLayout = DEFAULT_DESK;
  const queryClient = createQueryClient();
  const navigator: ItemNavigator = {
    workbench: { ...workbenchActions(host, reveals, titleContext), host, reveals, titleContext, showActivity: (id) => shownActivities.push(id) },
    queryClient,
    changeDesk: (change) => {
      desk = change(desk);
    },
    tell: (message) => told.push(message),
  };
  return {
    navigator,
    told,
    queryClient,
    /** Answers the read of `ref` once the page has asked for it. */
    answer: async (ref: string, answer: Answer): Promise<void> => {
      await vi.waitFor(() => expect([...asked.keys()]).toContain(ref));
      asked.get(ref)?.(answer);
    },
    itemTabsOpen: () => openTabs(host, ITEM_PANEL).map((tab) => tab.params),
    desk: () => desk,
    shownActivities,
  };
};

const NOT_FOUND = itemNotFound(previewName("HV-2"));
const UNREADABLE = "The invented apiary can't be read.";

test.each<[string, Answer, Item | undefined, unknown[]]>([
  ["finds its item", { status: 200, body: hive(2) }, hive(2), []],
  ["finds no item", { status: 404, body: { error: { code: ItemsErrorCode.enum.item_not_found, message: "No item HV-2." } } }, undefined, [NOT_FOUND]],
  ["fails", { status: 500, body: { error: { code: "internal_error", message: UNREADABLE } } }, undefined, [expect.stringContaining(UNREADABLE)]],
])("only the latest follow lands, though an earlier one's read comes back after it: the later read %s", async (_name, laterAnswer, lands, tells) => {
  const { navigator, told, queryClient, answer, itemTabsOpen, desk, shownActivities } = page();
  const earlier = hive(1);

  followItem(navigator, "HV-1");
  followItem(navigator, "HV-2");
  await answer("HV-2", laterAnswer);
  if (lands === undefined) await vi.waitFor(() => expect(queryClient.getQueryState(keys.item("HV-2"))?.status).toBe("error"));
  else await vi.waitFor(() => expect(desk().binderId).toBe(lands.binder));
  await answer("HV-1", { status: 200, body: earlier });
  await vi.waitFor(() => expect(queryClient.getQueryData(keys.item("HV-1"))).toBeDefined());
  // The earlier follow's own step after its read is queued behind the cache's; a timer runs only once that queue is empty.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(itemTabsOpen()).toEqual(lands === undefined ? [] : [tabOf(lands)]);
  expect(desk()).toEqual(lands === undefined ? DEFAULT_DESK : { ...DEFAULT_DESK, binderId: lands.binder });
  expect(shownActivities).toEqual(lands === undefined ? [] : [DESK_ACTIVITY]);
  expect(told).toEqual(tells);
});
