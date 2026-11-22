// An agent's open item proposals among a binder's items, pure: pending rows for creates, marks for updates and deletes,
// and rows of their own for changes to items that are gone.
import type { ItemSummary } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";

import { type ItemProposalRead, oldestFirst, openItemProposals, proposalsOnItem } from "../../../items/item-proposals.ts";
import { proposedLink } from "../../../items/values.ts";
import type { ItemsOf } from "../../../items/use-link-lists.ts";
import { type ItemRow, type LinkTarget, type MissingRow, type PendingRow, type Row, rowProposals } from "./view-model.ts";

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
