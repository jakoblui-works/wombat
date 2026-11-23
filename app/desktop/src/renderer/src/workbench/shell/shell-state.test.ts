// The shell state's contract (interface "Shell state"): what the right sidebar shows, each workspace's own tabs, and
// the right sidebar's width. Six readers derive from rightView, and the width's evidence lives here and nowhere else.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { proposal as listedProposal, summary } from "../../../../../test/summaries.ts";
import "../activities.ts";
import { DESK_ACTIVITY } from "../activity-ids.ts";
import { ITEM_PANEL } from "../items/item-params.ts";
import { DEFAULT_DESK } from "../items/navigation/desk-layout.ts";
import { PROPOSAL_PANEL } from "../proposals/proposal-params.ts";
import { isRestorable, isSaved, type TabTest } from "../registry.ts";
import { tabKey } from "../tabs.ts";
import type { TabRef } from "../workbench-context.ts";
import {
  activateTab,
  CHAT_MIN_WIDTH,
  closeOtherTabs,
  closeTab,
  dragShownRight,
  emptyShell,
  fitShownRight,
  keepTab,
  LEFT_WIDTH,
  leftBounds,
  openTab,
  pressToolbarButton,
  restoredShell,
  RIGHT_WIDTH,
  rightBounds,
  type RightView,
  rightView,
  rightWanted,
  savedShell,
  type ShellState,
  shownRightWidth,
  shownTab,
  tabActivity,
  type WorkspaceShell,
} from "./shell-state.ts";

// Invented workspaces and tabs.
const BAKERY = "ws-bakery0001";
const GARDEN = "ws-garden0002";
const WORKSPACES = [BAKERY, GARDEN] as const;

const item = (n: number, ws: string = BAKERY): TabRef => ({ panelId: ITEM_PANEL, params: { ws, binderId: "pages", itemId: `PAGE-${String(n)}` } });
// A tab without an activity: a proposal (a diff is another; panels/ isn't imported outside activities.ts).
const proposal: TabRef = { panelId: PROPOSAL_PANEL, params: { proposalId: "p-new-faq" } };
const key = (tab: TabRef): string => tabKey(tab.panelId, tab.params);
const kept = { temporary: false };

/** A shell with only BAKERY's workspace shell, from its fields. */
const bakery = (fields: Partial<WorkspaceShell>): ShellState => ({
  ...emptyShell,
  workspaces: { [BAKERY]: { tabs: [], navigatorHidden: false, rightOpen: false, activityStates: {}, right: { dragged: false }, ...fields } },
});
const entry = (tab: TabRef) => ({ ...tab, kept: true });

type Shows = { show: RightView["show"]; tab: string | undefined; activity: string | undefined };

/** What a view shows, by the tab's key and the navigator's activity. */
const shows = (view: RightView): Shows => ({
  show: view.show,
  tab: view.show === "tab" || view.show === "tab-and-navigator" ? key(view.tab) : undefined,
  activity: view.show === "navigator" || view.show === "tab-and-navigator" ? view.activity : undefined,
});
const CLOSED: Shows = { show: "closed", tab: undefined, activity: undefined };
const NAVIGATOR: Shows = { show: "navigator", tab: undefined, activity: DESK_ACTIVITY };
const tabAlone = (tab: TabRef): Shows => ({ show: "tab", tab: key(tab), activity: undefined });
const tabAndNavigator = (tab: TabRef): Shows => ({ show: "tab-and-navigator", tab: key(tab), activity: DESK_ACTIVITY });

const press = (state: ShellState): ShellState => pressToolbarButton(state, BAKERY, DESK_ACTIVITY);
const open = (state: ShellState, ...tabs: TabRef[]): ShellState => tabs.reduce((current, tab) => openTab(current, BAKERY, tab, kept), state);
/** Items 1 and 2 open, 1 active last, then a proposal on top: the Desk's last active tab is item 1. */
const deskThenProposal = (): ShellState => open(activateTab(open(emptyShell, item(1), item(2)), BAKERY, key(item(1))), proposal);

describe("what the right sidebar shows", () => {
  test.each<[string, () => ShellState, Shows]>([
    // The table's rows.
    ["closed, whatever its activity and tab", () => bakery({ activity: DESK_ACTIVITY, tabs: [entry(item(1))], active: key(item(1)) }), CLOSED],
    ["open on the Desk with no tab: the navigator alone", () => bakery({ rightOpen: true, activity: DESK_ACTIVITY }), NAVIGATOR],
    ["open on the Desk with no tab, the navigator hidden: the navigator alone", () => bakery({ rightOpen: true, activity: DESK_ACTIVITY, navigatorHidden: true }), NAVIGATOR],
    ["open on an item: the tab, the navigator beside it", () => bakery({ rightOpen: true, activity: DESK_ACTIVITY, tabs: [entry(item(1))], active: key(item(1)) }), tabAndNavigator(item(1))],
    [
      "open on an item, the navigator hidden: the tab alone",
      () => bakery({ rightOpen: true, activity: DESK_ACTIVITY, tabs: [entry(item(1))], active: key(item(1)), navigatorHidden: true }),
      tabAlone(item(1)),
    ],
    [
      "open on a proposal, the Desk the sidebar's activity: the tab alone",
      () => bakery({ rightOpen: true, activity: DESK_ACTIVITY, tabs: [entry(item(1)), entry(proposal)], active: key(proposal) }),
      tabAlone(proposal),
    ],
    // Pressing the toolbar's Desk button.
    ["pressed while closed with no Desk tab: the navigator alone", () => press(emptyShell), NAVIGATOR],
    ["pressed while closed: the Desk's last active tab", () => press(press(activateTab(open(emptyShell, item(1), item(2)), BAKERY, key(item(1))))), tabAndNavigator(item(1))],
    ["pressed while open on the navigator alone: closed", () => press(press(emptyShell)), CLOSED],
    ["pressed while open on an item: closed", () => press(open(emptyShell, item(1))), CLOSED],
    ["pressed while open on a proposal: the Desk's last active tab", () => press(deskThenProposal()), tabAndNavigator(item(1))],
    ["pressed while open on a proposal with no Desk tab: the navigator alone", () => press(open(emptyShell, proposal)), NAVIGATOR],
    // Closing tabs.
    [
      "closing the active tab: its right neighbour",
      () => closeTab(activateTab(open(emptyShell, item(1), item(2), proposal), BAKERY, key(item(2))), BAKERY, key(item(2))),
      tabAlone(proposal),
    ],
    ["closing the active rightmost tab: its left neighbour", () => closeTab(open(emptyShell, item(1), item(2)), BAKERY, key(item(2))), tabAndNavigator(item(1))],
    ["closing the last item tab: the Desk's navigator", () => closeTab(open(emptyShell, item(1)), BAKERY, key(item(1))), NAVIGATOR],
    ["closing the last tab without an activity: closed", () => closeTab(open(emptyShell, proposal), BAKERY, key(proposal)), CLOSED],
  ])("%s", (_name, state, expected) => {
    expect(shows(rightView(state(), BAKERY))).toEqual(expected);
  });
});

type Op =
  | { op: "open"; ws: number; n: number; temporary: boolean }
  | { op: "keep" | "activate" | "close" | "closeOthers"; ws: number; n: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("open" as const), ws: fc.nat({ max: 1 }), n: fc.nat({ max: 4 }), temporary: fc.boolean() }),
  fc.record({ op: fc.constantFrom("keep" as const, "activate" as const, "close" as const, "closeOthers" as const), ws: fc.nat({ max: 1 }), n: fc.nat({ max: 4 }) }),
);

const strip = (state: ShellState, ws: string): string[] => (state.workspaces[ws]?.tabs ?? []).map(key);
const temporaries = (state: ShellState, ws: string): string[] => (state.workspaces[ws]?.tabs ?? []).filter((tab) => !tab.kept).map(key);

test("tab changes in one workspace never touch another's; a temporary tab is replaced by the next open unless it has unsaved edits; Close others keeps tabs with unsaved edits", () => {
  fc.assert(
    fc.property(fc.array(opArb, { maxLength: 30 }), fc.subarray([0, 1, 2, 3, 4]), fc.subarray([0, 1, 2, 3, 4]), (ops, dirtyBakery, dirtyGarden) => {
      const dirty = new Set([...dirtyBakery.map((n) => key(item(n, BAKERY))), ...dirtyGarden.map((n) => key(item(n, GARDEN)))]);
      const isDirty = (tabKey: string): boolean => dirty.has(tabKey);
      let state: ShellState = { ...emptyShell, openAgent: "agent-oven-1" };
      for (const step of ops) {
        const ws = WORKSPACES[step.ws] ?? BAKERY;
        const other = WORKSPACES[1 - step.ws] ?? GARDEN;
        const tab = item(step.n, ws);
        const before = state;
        switch (step.op) {
          case "open":
            state = openTab(state, ws, tab, { temporary: step.temporary, isDirty });
            break;
          case "keep":
            state = keepTab(state, ws, key(tab));
            break;
          case "activate":
            state = activateTab(state, ws, key(tab));
            break;
          case "close":
            state = closeTab(state, ws, key(tab));
            break;
          case "closeOthers":
            state = closeOtherTabs(state, ws, key(tab), isDirty);
            break;
        }
        const was = strip(before, ws);
        const now = strip(state, ws);
        const told = `${JSON.stringify(step)} on ${JSON.stringify(was)}`;

        expect(state.workspaces[other], `${told} changed the other workspace`).toEqual(before.workspaces[other]);
        expect(state.openAgent, `${told} changed the open agent`).toBe(before.openAgent);
        // A tab with unsaved edits leaves the strip only by its own close.
        const lost = was.filter((open) => isDirty(open) && !now.includes(open) && !(step.op === "close" && open === key(tab)));
        expect(lost, `${told} lost tabs with unsaved edits`).toEqual([]);

        if (step.op === "open" && step.temporary && !was.includes(key(tab)) && temporaries(before, ws).every((open) => !isDirty(open))) {
          expect(temporaries(state, ws), `${told}: the new tab isn't the one temporary tab`).toEqual([key(tab)]);
          expect(now, `${told}: the strip didn't replace its temporary tab`).toHaveLength(temporaries(before, ws).length === 0 ? was.length + 1 : was.length);
        }
        if (step.op === "closeOthers") {
          expect(now, `${told}: Close others`).toEqual(was.filter((open) => open === key(tab) || isDirty(open)));
        }
      }
    }),
    { numRuns: 300 },
  );
});

describe("the right sidebar's width", () => {
  /** Each kind the sidebar shows, opened on BAKERY's closed sidebar. */
  const kinds: Record<string, (state: ShellState) => ShellState> = {
    navigator: (state) => press(state),
    item: (state) => openTab(state, BAKERY, item(1), kept),
    proposal: (state) => openTab(state, BAKERY, proposal, kept),
  };
  const kindArb = fc.constantFrom(...Object.keys(kinds));
  const openOn = (kind: string, state: ShellState = emptyShell): ShellState => (kinds[kind] ?? press)(state);
  const wantedOf = (state: ShellState, ws: string): number => rightWanted(rightView(state, ws)) ?? Number.NaN;
  /** A room wide enough for every kind's wants beside the chat. */
  const ROOMY = RIGHT_WIDTH.max + CHAT_MIN_WIDTH;
  const roomArb = fc.integer({ min: 0, max: ROOMY + 400 });
  const dxArb = fc.integer({ min: -ROOMY, max: ROOMY });

  /** The sidebar's own close for what it shows: its pressed button, else the last tab without an activity. */
  const closeRight = (state: ShellState, ws: string): ShellState => {
    const tab = shownTab(state, ws);
    return tab !== undefined && tabActivity(tab.panelId) === undefined ? closeTab(state, ws, key(tab)) : pressToolbarButton(state, ws, DESK_ACTIVITY);
  };

  test("the stored width never holds the window's clamp: a window shrunk and regrown gets the kind's or the dragged width back", () => {
    fc.assert(
      fc.property(kindArb, fc.array(roomArb, { minLength: 1, maxLength: 8 }), fc.option(fc.record({ room: roomArb, dx: dxArb })), (kind, rooms, drag) => {
        let state = fitShownRight(openOn(kind), BAKERY);
        const wanted = wantedOf(state, BAKERY);
        let dragged: number | undefined;
        if (drag !== null) {
          state = dragShownRight(state, BAKERY, drag.dx, rightBounds(drag.room));
          dragged = shownRightWidth(state, BAKERY, rightBounds(drag.room));
        }
        for (const room of rooms) {
          // The sidebar fits whenever it likes; the window only bounds what is drawn.
          state = fitShownRight(state, BAKERY);
          const drawn = shownRightWidth(state, BAKERY, rightBounds(room));
          if (drag === null && room - CHAT_MIN_WIDTH >= wanted) expect(drawn, `at room ${String(room)} after ${JSON.stringify(rooms)}`).toBe(wanted);
        }
        if (drag !== null) expect(shownRightWidth(state, BAKERY, rightBounds(drag.room)), `back at the drag's room after ${JSON.stringify(rooms)}`).toBe(dragged);
      }),
      { numRuns: 300 },
    );
  });

  test("a close resets only its own workspace's width; a fit or drag on a closed sidebar changes nothing, so it reopens at the kind's width", () => {
    fc.assert(
      fc.property(kindArb, kindArb, dxArb, dxArb, dxArb, roomArb, (bakeryKind, gardenKind, bakeryDx, gardenDx, closedDx, closedRoom) => {
        const gardenOpen = (state: ShellState): ShellState =>
          gardenKind === "navigator" ? pressToolbarButton(state, GARDEN, DESK_ACTIVITY) : openTab(state, GARDEN, gardenKind === "item" ? item(1, GARDEN) : proposal, kept);
        let state = fitShownRight(fitShownRight(gardenOpen(openOn(bakeryKind)), BAKERY), GARDEN);
        state = dragShownRight(state, BAKERY, bakeryDx, rightBounds(ROOMY));
        state = dragShownRight(state, GARDEN, gardenDx, rightBounds(ROOMY));
        const gardenWidth = shownRightWidth(state, GARDEN, rightBounds(ROOMY));

        const closed = closeRight(state, BAKERY);
        expect(shows(rightView(closed, BAKERY))).toEqual(CLOSED);
        expect(shownRightWidth(closed, GARDEN, rightBounds(ROOMY)), "closing BAKERY's sidebar changed GARDEN's width").toBe(gardenWidth);
        expect(fitShownRight(closed, BAKERY), "a fit on the closed sidebar").toEqual(closed);
        expect(dragShownRight(closed, BAKERY, closedDx, rightBounds(closedRoom)), "a drag on the closed sidebar").toEqual(closed);

        const reopened = fitShownRight(openOn(bakeryKind, fitShownRight(dragShownRight(closed, BAKERY, closedDx, rightBounds(closedRoom)), BAKERY)), BAKERY);
        expect(shownRightWidth(reopened, BAKERY, rightBounds(ROOMY)), "reopened at a stale width").toBe(wantedOf(reopened, BAKERY));
      }),
      { numRuns: 300 },
    );
  });

  test("for any room the chat keeps its minimum width; the sidebars give way below their own only when the room is short", () => {
    fc.assert(
      fc.property(roomArb, fc.boolean(), (room, rightOpen) => {
        const right = rightBounds(room);
        expect(right.min, `right at ${String(room)}`).toBeLessThanOrEqual(right.max);
        expect(right.max, `right at ${String(room)}`).toBeLessThanOrEqual(RIGHT_WIDTH.max);
        expect(room - right.max, `the chat beside the right sidebar at ${String(room)}`).toBeGreaterThanOrEqual(Math.min(CHAT_MIN_WIDTH, room));
        if (room >= RIGHT_WIDTH.min + CHAT_MIN_WIDTH) expect(right.min, `right at ${String(room)}`).toBe(RIGHT_WIDTH.min);

        const left = leftBounds(room, rightOpen);
        expect(left.min).toBe(LEFT_WIDTH.min);
        expect(left.max, `left at ${String(room)}`).toBeGreaterThanOrEqual(left.min);
        expect(left.max, `left at ${String(room)}`).toBeLessThanOrEqual(LEFT_WIDTH.max);
        const others = CHAT_MIN_WIDTH + (rightOpen ? RIGHT_WIDTH.min : 0);
        if (room - left.min >= others) {
          expect(room - left.max, `the chat${rightOpen ? " and the right sidebar" : ""} beside the widest left sidebar at ${String(room)}`).toBeGreaterThanOrEqual(others);
          // The left sidebar at its widest leaves the right sidebar its own minimum.
          if (rightOpen) expect(rightBounds(room - left.max).min).toBe(RIGHT_WIDTH.min);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// The saved shell's contract (contract "App settings, version 2", its `shell`): what savedShell writes is what
// restoredShell reads back at the next start, through settings.json.
describe("the saved shell across a quit and a start", () => {
  // The diff panel's id, as registered (panels/ isn't imported outside activities.ts). A tab of it that should come
  // back keeps a renamed id from passing for a dropped one.
  const DIFF_PANEL = "diff";
  const diff = (agentId: string, requestId: string): TabRef => ({ panelId: DIFF_PANEL, params: { agentId, requestId } });
  const proposalTab = (proposalId: string): TabRef => ({ panelId: PROPOSAL_PANEL, params: { proposalId } });
  const draft: TabRef = { panelId: ITEM_PANEL, params: { ws: BAKERY, binderId: "pages", draft: "draft-tuesday-hours", context: {} } };
  const DESK = { binderId: "pages", view: "Board", openDrawers: ["recipes"] };

  const workspace = (fields: Partial<WorkspaceShell>): WorkspaceShell => ({
    tabs: [],
    navigatorHidden: false,
    rightOpen: false,
    activityStates: {},
    right: { dragged: false },
    ...fields,
  });
  const temporary = (tab: TabRef) => ({ ...tab, kept: false });
  /** Through settings.json: what main writes and reads back. */
  const throughFile = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
  const reopened = (state: ShellState, restorable: TabTest = () => true): ShellState => restoredShell(throughFile(savedShell(state, isSaved)), restorable);
  const tabKeys = (state: ShellState, ws: string): string[] => (state.workspaces[ws]?.tabs ?? []).map(key);

  /** What a start gives back of a shell: its open agent, left sidebar and each workspace's tabs, activity, navigator and Desk. */
  const kept = (state: ShellState) => ({
    openAgent: state.openAgent,
    leftHidden: state.leftHidden,
    workspaces: Object.fromEntries(
      Object.entries(state.workspaces).map(([id, shell]) => [
        id,
        {
          tabs: shell.tabs.map((tab) => ({ key: key(tab), kept: tab.kept })),
          active: shell.active,
          activity: shell.activity,
          navigatorHidden: shell.navigatorHidden,
          rightOpen: shell.rightOpen,
          desk: shell.activityStates[DESK_ACTIVITY],
        },
      ]),
    ),
  });

  test("a start gives back the open agent, the left sidebar and each workspace's kept tabs, active tab, activity, navigator and Desk", () => {
    const shells: ShellState[] = [
      {
        ...emptyShell,
        openAgent: "agent-oven-1",
        leftHidden: true,
        workspaces: {
          [BAKERY]: workspace({
            tabs: [entry(item(1)), entry(item(2)), entry(proposal)],
            active: key(item(2)),
            activity: DESK_ACTIVITY,
            navigatorHidden: true,
            rightOpen: true,
            activityStates: { [DESK_ACTIVITY]: DESK },
            right: { width: 733, dragged: true },
          }),
          [GARDEN]: workspace({ tabs: [entry(item(3, GARDEN))], active: key(item(3, GARDEN)), activity: DESK_ACTIVITY }),
        },
      },
      { ...emptyShell, workspaces: { [GARDEN]: workspace({ activity: DESK_ACTIVITY, rightOpen: true, activityStates: { [DESK_ACTIVITY]: { openDrawers: [] } } }) } },
    ];
    for (const state of shells) expect(kept(reopened(state))).toEqual(kept(state));
  });

  test("a save leaves out temporary tabs and tabs their panel doesn't save (a draft's)", () => {
    const state = bakery({ tabs: [entry(item(1)), temporary(item(2)), entry(draft), temporary(item(3))], active: key(item(1)), activity: DESK_ACTIVITY, rightOpen: true });
    expect(tabKeys(reopened(state), BAKERY)).toEqual([key(item(1))]);
  });

  test("a start leaves out the tabs isRestorable refuses: a deleted agent's diff and a decided proposal's tab", () => {
    const restorable = isRestorable({
      agents: [summary("agent-oven-1", { state: "waiting", hasProcess: true, pendingPermissions: [{ requestId: "req-7" } as never] })],
      proposals: [listedProposal("p-open-prices", "agent-oven-1"), { ...listedProposal("p-decided-menu", "agent-oven-1"), status: "approved" }],
    });
    const state = bakery({
      tabs: [entry(item(1)), entry(diff("agent-oven-1", "req-7")), entry(diff("agent-deleted", "req-9")), entry(proposalTab("p-open-prices")), entry(proposalTab("p-decided-menu"))],
      active: key(item(1)),
      activity: DESK_ACTIVITY,
      rightOpen: true,
    });
    expect(tabKeys(reopened(state, restorable), BAKERY)).toEqual([key(item(1)), key(diff("agent-oven-1", "req-7")), key(proposalTab("p-open-prices"))]);
  });

  test("a closed right sidebar stays closed when its active tab doesn't come back", () => {
    const gone = proposalTab("p-decided-menu");
    const refusesGone: TabTest = (panelId, params) => key({ panelId, params }) !== key(gone);
    // With a tab beside it, and alone.
    for (const tabs of [[entry(item(1)), entry(gone)], [entry(gone)]]) {
      const state = reopened(bakery({ tabs, active: key(gone), activity: DESK_ACTIVITY, rightOpen: false }), refusesGone);
      expect(shows(rightView(state, BAKERY)), `with ${String(tabs.length)} tabs`).toEqual(CLOSED);
    }
  });

  test.each<[string, unknown]>([
    ["nothing saved", undefined],
    ["null", null],
    ["a string", "not a shell"],
    ["an array", [{ panelId: ITEM_PANEL }]],
    ["fields of the wrong type", { openAgent: 7, leftHidden: "yes", workspaces: "bakery" }],
    ["a workspace without its flags", { leftHidden: false, workspaces: { [BAKERY]: { tabs: [] } } }],
  ])("a saved value that doesn't parse (%s) gives the default shell", (_name, raw) => {
    expect(restoredShell(raw, () => true)).toEqual(emptyShell);
  });

  test("a Desk state that doesn't parse comes back as the Desk's default, the rest of the shell as saved", () => {
    for (const desk of [{ openDrawers: "recipes" }, 7, { binderId: 3, openDrawers: [] }]) {
      const state = bakery({ tabs: [entry(item(1))], active: key(item(1)), activity: DESK_ACTIVITY, rightOpen: true, activityStates: { [DESK_ACTIVITY]: desk } });
      const back = reopened(state);
      expect(back.workspaces[BAKERY]?.activityStates[DESK_ACTIVITY], JSON.stringify(desk)).toEqual(DEFAULT_DESK);
      expect(tabKeys(back, BAKERY)).toEqual([key(item(1))]);
    }
  });
});
