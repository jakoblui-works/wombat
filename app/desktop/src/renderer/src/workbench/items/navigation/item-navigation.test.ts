import fc from "fast-check";
import { afterEach, expect, test, vi } from "vitest";

import { ItemsErrorCode } from "@wombat/shared/api";
import type { Item } from "@wombat/shared/items";

import { keys } from "../../../data/keys.ts";
import { createQueryClient } from "../../../data/query-client.ts";
import "../../activities.ts";
import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { fakeShell } from "../../shell/fake-shell.test-support.ts";
import { shellWorkbench } from "../../shell/RightSidebar/tab-actions.ts";
import { tabTitleStore } from "../../shell/RightSidebar/tab-titles.ts";
import { activityStateOf, changeActivityState, rightView } from "../../shell/shell-state.ts";
import { revealStore, tabKey } from "../../tabs.ts";
import { previewName } from "../ItemPreview/item-preview.ts";
import { ITEM_PANEL } from "../item-params.ts";
import { itemNotFound } from "../reads.ts";
import { DEFAULT_DESK, type DeskLayout } from "./desk-layout.ts";
import { followItem, type ItemNavigator, itemTabs, openBinder } from "./item-navigation.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEMS = 5;
const itemTab = (n: number) => ({ ws: "ws-chores0001", binderId: "chores", itemId: `0196f3c2-5a00-7000-8000-${n.toString(16).padStart(12, "0")}` });
const item = fc.nat({ max: ITEMS - 1 });

/** The workbench's tab actions on a shell state of their own, with no workspace shown. */
const shellTabs = (reveals = revealStore()) => {
  const { current, change } = fakeShell();
  const actions = shellWorkbench({ current, change, reveals, titles: tabTitleStore() });
  return { actions, reveals };
};

test("an item's tabs are found by its id, whichever binder they were opened from, and no draft's or other item's tab", () => {
  const binderArb = fc.constantFrom("tasks", "archive", "notes", "chores");
  // Item tabs, each showing item 0..ITEMS-1 as opened from some binder; draft tabs, from some binder.
  const openArb = fc.array(fc.oneof(fc.record({ n: item, binderId: binderArb }), fc.record({ draft: fc.nat({ max: 3 }), binderId: binderArb })), { maxLength: 12 });
  fc.assert(
    fc.property(openArb, item, (opened, wanted) => {
      const { actions } = shellTabs();
      const showing = new Set<string>();
      for (const each of opened) {
        const params = "n" in each ? { ...itemTab(each.n), binderId: each.binderId } : { ws: itemTab(0).ws, binderId: each.binderId, draft: `draft-${String(each.draft)}`, context: {} };
        actions.openTab(ITEM_PANEL, params, undefined, { workspace: params.ws });
        if ("n" in each && each.n === wanted) showing.add(tabKey(ITEM_PANEL, params));
      }
      const found = itemTabs({ workbench: actions }, itemTab(wanted).itemId).map((tab) => tabKey(tab.panelId, tab.params));
      expect(new Set(found), `item ${String(wanted)} among ${JSON.stringify(opened)}`).toEqual(showing);
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
  const ws = { id: "ws-apiary0001", name: "apiary", root: "/invented/apiary", missing: false };
  const request = (_method: string, path: string): Promise<Answer> => {
    if (path === "/workspaces") return Promise.resolve({ status: 200, body: { workspaces: [ws] } });
    if (path === `/workspaces/${ws.id}/binders`) return Promise.resolve({ status: 200, body: { binders: [] } });
    return new Promise((resolve) => asked.set(decodeURIComponent(path.replace(`/workspaces/${ws.id}/items/`, "")), resolve));
  };
  vi.stubGlobal("window", { wombat: { service: { request }, workspace: { get: () => Promise.resolve({ root: ws.root }) } } });

  // The view the follows land on: a shell state of the test's own, showing the apiary.
  const { current, change, tickets } = fakeShell({ workspaces: [ws] });
  const { take, land } = tickets;
  const reveals = revealStore();
  const actions = shellWorkbench({ current, change, reveals, titles: tabTitleStore() });
  const shownActivities: string[] = [];
  const told: string[] = [];
  let desk: DeskLayout = DEFAULT_DESK;
  const queryClient = createQueryClient();
  const navigator: ItemNavigator = {
    workbench: {
      ...actions,
      showActivity: (id, workspace) => {
        shownActivities.push(id);
        actions.showActivity(id, workspace);
      },
    },
    queryClient,
    changeDesk: (change) => {
      desk = change(desk);
    },
    tell: (message) => told.push(message),
    take,
    land,
  };
  return {
    navigator,
    told,
    queryClient,
    ws: ws.id,
    /** Answers the read of `ref` once the page has asked for it. */
    answer: async (ref: string, answer: Answer): Promise<void> => {
      await vi.waitFor(() => expect([...asked.keys()]).toContain(ref));
      asked.get(ref)?.(answer);
    },
    itemTabsOpen: () => actions.openTabs(ITEM_PANEL).map((tab) => tab.params),
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
  const { navigator, told, queryClient, ws, answer, itemTabsOpen, desk, shownActivities } = page();
  const earlier = hive(1);

  followItem(navigator, ws, "HV-1");
  followItem(navigator, ws, "HV-2");
  await answer("HV-2", laterAnswer);
  if (lands === undefined) await vi.waitFor(() => expect(queryClient.getQueryState(keys.item(ws, "HV-2"))?.status).toBe("error"));
  else await vi.waitFor(() => expect(desk().binderId).toBe(lands.binder));
  await answer("HV-1", { status: 200, body: earlier });
  await vi.waitFor(() => expect(queryClient.getQueryData(keys.item(ws, "HV-1"))).toBeDefined());
  // The earlier follow's own step after its read is queued behind the cache's; a timer runs only once that queue is empty.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(itemTabsOpen()).toEqual(lands === undefined ? [] : [{ ws, ...tabOf(lands) }]);
  expect(desk()).toEqual(lands === undefined ? DEFAULT_DESK : { ...DEFAULT_DESK, binderId: lands.binder });
  expect(shownActivities).toEqual(lands === undefined ? [] : [DESK_ACTIVITY]);
  expect(told).toEqual(tells);
});

test("openBinder of another workspace opens that workspace's Desk on the binder and leaves the shown one's alone", async () => {
  const SHOWN = "ws-apiary0001";
  const OTHER = "ws-meadow0002";
  const listed = (id: string, name: string) => ({ id, name, root: `/invented/${name}`, missing: false });
  // The first listed workspace is the shown one.
  const { current, change, tickets } = fakeShell({ workspaces: [listed(SHOWN, "apiary"), listed(OTHER, "meadow")] });
  const queryClient = createQueryClient();
  for (const ws of [SHOWN, OTHER]) queryClient.setQueryData(keys.binders(ws), { binders: [] });
  // As the shell wires it: a Desk change names its workspace.
  const navigator: ItemNavigator = {
    workbench: shellWorkbench({ current, change, reveals: revealStore(), titles: tabTitleStore() }),
    queryClient,
    changeDesk: (update, ws) => change((before) => changeActivityState(before, ws, DESK_ACTIVITY, (desk) => update(desk as DeskLayout))),
    tell: () => undefined,
    ...tickets,
  };
  const deskIn = (ws: string): DeskLayout => activityStateOf(current().state, ws, DESK_ACTIVITY) as DeskLayout;

  openBinder(navigator, OTHER, "hives");

  await vi.waitFor(() => expect(deskIn(OTHER).binderId).toBe("hives"));
  expect(rightView(current().state, OTHER)).toEqual({ show: "navigator", activity: DESK_ACTIVITY });
  expect(deskIn(SHOWN)).toEqual(DEFAULT_DESK);
  expect(rightView(current().state, SHOWN)).toEqual({ show: "closed" });
});
