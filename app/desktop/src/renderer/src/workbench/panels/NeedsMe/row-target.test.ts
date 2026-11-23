// Where a Needs me row opens, and whether an open that waited on its reads still lands: only while the shell shows
// what the row's click left, so a late open never covers what the user did since.
import { expect, test } from "vitest";

import type { AgentSummary } from "@wombat/shared/api";
import type { BinderSummary } from "@wombat/shared/items";
import type { Proposal } from "@wombat/shared/proposals";

import { atFor } from "../../../../../../../shared/test/log-entries.ts";
import { proposal, summary } from "../../../../../../test/summaries.ts";
import "../../activities.ts";
import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { collapseGroup } from "../../agents/collapsed-groups.ts";
import { ITEM_PANEL } from "../../items/item-params.ts";
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
} from "../../shell/shell-state.ts";
import { tabKey } from "../../tabs.ts";
import { needsMeRows, type NeedsMeRow } from "./needs-me-rows.ts";
import { proposalRows } from "./proposal-rows.ts";
import { itemOpen, lateOpen, rowTarget } from "./row-target.ts";

// Invented workspaces, agents, binders and proposals.
const BAKERY = "ws-bakery0001";
const GARDEN = "ws-garden0002";
const NOW = Date.parse(atFor(100));

const requestRow = (agent: AgentSummary): NeedsMeRow => needsMeRows([agent], NOW)[0]!;
const proposalRow = (fields: Partial<Proposal>): NeedsMeRow => proposalRows([{ ...proposal("proposal-1"), workspace: GARDEN, ...fields } as Proposal], [], NOW)[0]!;
const fileProposal = (kind: "edit" | "create"): Partial<Proposal> => ({ target: "file", kind, path: "/home/someone/garden/notes.txt", outsideWorkspace: false });

const pagesBinder: BinderSummary = {
  id: "pages",
  name: "Pages",
  prefix: "PAGE",
  access: "propose",
  naming: "handle",
  instructions: "off",
  properties: {},
  views: [],
  path: "pages",
  itemCount: 3,
  invalidCount: 0,
  problems: [],
};
const brokenBinder: BinderSummary = { id: null, path: "pages", itemCount: 0, invalidCount: 0, problems: [{ message: "The settings don't parse." }] };

type Reads = { binders: readonly BinderSummary[] | undefined; itemId: string | undefined };
const READ: Reads = { binders: [pagesBinder], itemId: "item-0003" };

/** Where the row opens once an item target's reads (`reads`) are back. */
const opensAt = (row: NeedsMeRow, { binders, itemId }: Reads) => {
  const target = rowTarget(row);
  return target.open === "item" ? itemOpen(target, binders, itemId) : target;
};

const inProposalTab = { open: "proposal", workspace: GARDEN, proposalId: "proposal-1" };
const atItem = { open: "item", workspace: GARDEN, binderId: "pages", itemId: "item-0003", proposalId: "proposal-1" };

test.each<[string, NeedsMeRow, Reads, object]>([
  [
    "a permission request: its agent's chat at the request",
    requestRow(summary("agent-1", { workspace: BAKERY, state: "waiting", pendingPermissions: [{ requestId: "r1", at: atFor(5), title: "Edit notes.txt", kind: "edit" }] })),
    READ,
    { open: "chat", workspace: BAKERY, agentId: "agent-1", requestId: "r1" },
  ],
  [
    "a waiting agent without a request: its agent's chat",
    requestRow(summary("agent-2", { workspace: BAKERY, state: "waiting" })),
    READ,
    { open: "chat", workspace: BAKERY, agentId: "agent-2", requestId: undefined },
  ],
  ["a change to an item: the item, revealed at the proposal", proposalRow({ kind: "update", handle: "PAGE-3" }), READ, atItem],
  ["a delete of an item: the item, revealed at the proposal", proposalRow({ kind: "delete", handle: "PAGE-3" }), READ, atItem],
  ["a new item: its proposal tab", proposalRow({ kind: "create", handle: null }), READ, inProposalTab],
  ["a new item with a handle: its proposal tab", proposalRow({ kind: "create", handle: "PAGE-9" }), READ, inProposalTab],
  ["a change to a file: its proposal tab", proposalRow(fileProposal("edit")), READ, inProposalTab],
  ["a new file: its proposal tab", proposalRow(fileProposal("create")), READ, inProposalTab],
  ["an item change, the binders not read: its proposal tab", proposalRow({ kind: "update", handle: "PAGE-3" }), { ...READ, binders: undefined }, inProposalTab],
  ["an item change, the item not found: its proposal tab", proposalRow({ kind: "update", handle: "PAGE-3" }), { ...READ, itemId: undefined }, inProposalTab],
  ["an item change, its binder not listed: its proposal tab", proposalRow({ kind: "update", handle: "PAGE-3" }), { ...READ, binders: [] }, inProposalTab],
  ["an item change, its binder broken: its proposal tab", proposalRow({ kind: "update", handle: "PAGE-3" }), { ...READ, binders: [brokenBinder] }, inProposalTab],
])("where a Needs me row opens: %s", (_, row, reads, expected) => {
  expect(opensAt(row, reads)).toEqual(expected);
});

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
])("a pending Needs me open lands only while the view is the one its click left: %s", (_, now, expected) => {
  expect(lateOpen(shownView(clicked, AGENTS, WORKSPACES), now())).toBe(expected);
});
