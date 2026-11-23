// Whether an open that waited on a read still lands: only while the shell shows what its click left, so a late open
// never covers what the user did since.
import { expect, test } from "vitest";

import { atFor } from "../../../../../../shared/test/log-entries.ts";
import { summary } from "../../../../../test/summaries.ts";
import "../activities.ts";
import { DESK_ACTIVITY } from "../activity-ids.ts";
import { collapseGroup } from "../agents/collapsed-groups.ts";
import { ITEM_PANEL } from "../items/item-params.ts";
import { tabKey } from "../tabs.ts";
import { ticketLands } from "./open-ticket.ts";
import {
  activateTab,
  dragShownRight,
  emptyShell,
  fitShownRight,
  hideNavigator,
  newChat,
  openAgent,
  openTab,
  pressToolbarButton,
  rightBounds,
  type ShellState,
  showWorkspace,
  type ShownView,
  shownView,
} from "./shell-state.ts";

// Invented workspaces and agents.
const BAKERY = "ws-bakery0001";
const GARDEN = "ws-garden0002";

const AGENTS = [
  summary("agent-1", { workspace: BAKERY, startedAt: atFor(1) }),
  summary("agent-2", { workspace: BAKERY, startedAt: atFor(2) }),
  summary("agent-3", { workspace: GARDEN, startedAt: atFor(3) }),
];
const WORKSPACES = [{ id: BAKERY }, { id: GARDEN }];
const page = (n: number) => ({ panelId: ITEM_PANEL, params: { ws: BAKERY, binderId: "pages", itemId: `item-${String(n)}` } });

/** What a click left: agent 1's chat, its workspace's Desk open on page 2 beside the navigator, page 1 open too. */
const clicked: ShellState = [page(1), page(2)].reduce((state, tab) => openTab(state, BAKERY, tab, { temporary: false }), openAgent(emptyShell, "agent-1"));
const bounds = rightBounds(1600);

/** The view after `change`, with the agents read or not yet. */
const after = (change: (state: ShellState) => ShellState, { agentsRead = true } = {}): ShownView =>
  shownView(change(clicked), agentsRead ? AGENTS : undefined, WORKSPACES);

test.each<[string, () => ShownView, "open" | "drop" | "wait"]>([
  ["nothing changed", () => after((state) => state), "open"],
  ["another agent opened", () => after((state) => openAgent(state, "agent-2")), "drop"],
  ["the empty chat opened on the same workspace", () => after((state) => newChat(state, BAKERY)), "drop"],
  ["another workspace shown", () => after((state) => showWorkspace(state, GARDEN, AGENTS, WORKSPACES)), "drop"],
  ["another tab made active", () => after((state) => activateTab(state, BAKERY, tabKey(page(1).panelId, page(1).params))), "drop"],
  ["the right sidebar closed", () => after((state) => pressToolbarButton(state, BAKERY, DESK_ACTIVITY)), "drop"],
  ["another activity shown", () => after((state) => pressToolbarButton(state, BAKERY, "another-activity")), "drop"],
  ["the navigator hidden", () => after((state) => hideNavigator(state, BAKERY, true)), "drop"],
  ["the group collapsed", () => after((state) => collapseGroup(state, BAKERY, true)), "open"],
  ["the right sidebar resized", () => after((state) => dragShownRight(fitShownRight(state, BAKERY), BAKERY, 80, bounds)), "open"],
  // The open agent's workspace isn't known until the agents are read.
  ["nothing shown yet", () => after((state) => state, { agentsRead: false }), "wait"],
])("the latest ticket's open lands only while the view is the one its click left: %s", (_, now, expected) => {
  expect(ticketLands({ seq: 1, view: shownView(clicked, AGENTS, WORKSPACES) }, 1, now())).toBe(expected);
});
