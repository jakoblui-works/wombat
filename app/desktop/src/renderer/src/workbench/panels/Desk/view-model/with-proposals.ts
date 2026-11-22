// An agent's open item proposals among a binder's items, pure: pending rows for creates, marks for updates and deletes,
// and rows of their own for changes to items that are gone.
import type { ItemSummary } from "@wombat/shared/items";
import { isOpen, type ItemProposal, type Proposal } from "@wombat/shared/proposals";

import { proposedLink } from "../../../items/values.ts";
import type { ItemsOf } from "../../../items/use-link-lists.ts";
import { type ItemRow, type LinkTarget, type MissingRow, type PendingRow, type Row, rowProposals } from "./view-model.ts";

/** An item proposal as listed, or as read on its own with its latest version's `fields` (a create shows only then). */
export type ItemProposalRead = ItemProposal & { fields?: Readonly<Record<string, unknown>> };

const oldestFirst = (a: Proposal, b: Proposal): number => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The binder's open item proposals, oldest first. */
export const openItemProposals = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string): Extract<P, { target: "item" }>[] =>
  proposals.filter((p): p is Extract<P, { target: "item" }> => p.target === "item" && p.binder === binderId && isOpen(p.status)).sort(oldestFirst);

/** An item proposal that changes an item already there. */
export type ItemChange<P> = Extract<P, { target: "item" }> & { kind: "update" | "delete" };

/** The open updates and deletes proposed on the item with `handle` in the binder, oldest first. */
export const proposalsOnItem = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string, handle: string | null): ItemChange<P>[] =>
  handle === null ? [] : openItemProposals(proposals, binderId).filter((p): p is ItemChange<P> => p.kind !== "create" && p.handle === handle);

/**
 * Every item as an item row, carrying the open updates and deletes on it (matched by handle) and marked with the oldest;
 * one row per handle that open updates or deletes name but no item has (deleted or renamed by hand); then one pending
 * row per open create of the binder whose fields are read, each link found only among `itemsOf` its property's binder.
 * Other binders' and decided proposals don't show.
 */
export const withProposals = (items: readonly ItemSummary[], proposals: readonly ItemProposalRead[], binderId: string, itemsOf: ItemsOf): Row[] => {
  const open = openItemProposals(proposals, binderId);
  const link: LinkTarget = (to, id) => proposedLink(id, itemsOf(to));
  const itemRows = items.map((item): ItemRow => {
    const on = proposalsOnItem(open, binderId, item.handle);
    const [mark] = on;
    return mark === undefined ? { item } : { item, proposals: on, proposal: mark };
  });
  const handles = new Set(items.map(({ handle }) => handle));
  const missing = [...new Set(open.flatMap(({ kind, handle }) => (kind === "create" || handle === null || handles.has(handle) ? [] : [handle])))].map(
    (handle): MissingRow => ({ missing: handle, proposals: proposalsOnItem(open, binderId, handle) }),
  );
  const pending = open.flatMap((proposal): PendingRow[] =>
    proposal.kind === "create" && proposal.fields !== undefined ? [{ pending: proposal, fields: proposal.fields, link }] : [],
  );
  return [...itemRows, ...missing, ...pending];
};

export const OUTSIDE_FILTER = "Outside the filter";

/** Every open proposal a row shows a line for (its mark, Approve and Reject), oldest first. */
export const proposalLines = (row: Row): ItemProposal[] => [...rowProposals(row)].sort(oldestFirst);

/** The proposal a click on a row without an item opens: its create, or the oldest change of its missing item. */
export const opensProposal = (row: PendingRow | MissingRow): string | undefined => proposalLines(row)[0]?.id;

export const rowProposalIds = (row: Row): string[] => rowProposals(row).map(({ id }) => id);

/** Whether an item's row is struck through: its mark is a proposed delete. */
export const struck = (row: ItemRow): boolean => row.proposal?.kind === "delete";
