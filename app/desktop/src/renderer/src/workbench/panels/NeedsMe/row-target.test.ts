// Where a Needs me row opens.
import { expect, test } from "vitest";

import type { AgentSummary } from "@wombat/shared/api";
import type { BinderSummary } from "@wombat/shared/items";
import type { Proposal } from "@wombat/shared/proposals";

import { atFor } from "../../../../../../../shared/test/log-entries.ts";
import { proposal, summary } from "../../../../../../test/summaries.ts";
import { needsMeRows, type NeedsMeRow } from "./needs-me-rows.ts";
import { proposalRows } from "./proposal-rows.ts";
import { itemOpen, rowTarget } from "./row-target.ts";

// Invented workspaces, agents, binders and proposals.
const BAKERY = "ws-bakery0001";
const GARDEN = "ws-garden0002";
const NOW = Date.parse(atFor(100));

const requestRow = (agent: AgentSummary): NeedsMeRow => needsMeRows([agent], [], NOW)[0]!;
const proposalRow = (fields: Partial<Proposal>): NeedsMeRow => proposalRows([{ ...proposal("proposal-1"), workspace: GARDEN, ...fields } as Proposal], [], [], NOW)[0]!;
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
