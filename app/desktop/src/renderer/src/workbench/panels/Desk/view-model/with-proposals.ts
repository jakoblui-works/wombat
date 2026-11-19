// An agent's open item proposals among a binder's items, pure: pending rows for creates, marks for updates and deletes.
import type { ItemSummary } from "@wombat/shared/items";
import { isOpen, type ItemProposal, type Proposal } from "@wombat/shared/proposals";

import type { ItemRow, LinkTarget, PendingRow, Row } from "./view-model.ts";

/** An item proposal as listed, or as read on its own with its latest version's `fields` (a create shows only then). */
export type ItemProposalRead = ItemProposal & { fields?: Readonly<Record<string, unknown>> };

const oldestFirst = (a: Proposal, b: Proposal): number => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The binder's open item proposals, oldest first. */
export const openItemProposals = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string): Extract<P, { target: "item" }>[] =>
  proposals.filter((p): p is Extract<P, { target: "item" }> => p.target === "item" && p.binder === binderId && isOpen(p.status)).sort(oldestFirst);

/** The open updates and deletes proposed on the item with `handle` in the binder, oldest first. */
export const proposalsOnItem = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string, handle: string | null): Extract<P, { target: "item" }>[] =>
  handle === null ? [] : openItemProposals(proposals, binderId).filter((p) => p.kind !== "create" && p.handle === handle);

/**
 * Where a proposed link is looked up: a link to this binder among its own `items`, a link to another among the rest of
 * `targets`, so a copied file here never stands in for another binder's item.
 */
const linkTarget = (binderId: string, items: readonly ItemSummary[], targets: readonly ItemSummary[]): LinkTarget => {
  const own = new Set(items);
  const others = targets.filter((target) => !own.has(target));
  return (to, id) => ({ id, handle: (to === binderId ? items : others).find((target) => target.id === id)?.handle ?? null });
};

/**
 * Every item as an item row, carrying the open updates and deletes on it (matched by handle) and marked with the oldest,
 * then one pending row per open create of the binder whose fields are read, its links found among `targets` (every
 * item a link field may name: the binder's own and its linked binders'). Other binders' and decided proposals don't show.
 */
export const withProposals = (items: readonly ItemSummary[], proposals: readonly ItemProposalRead[], binderId: string, targets: readonly ItemSummary[] = items): Row[] => {
  const open = openItemProposals(proposals, binderId);
  const link = linkTarget(binderId, items, targets);
  const itemRows = items.map((item): ItemRow => {
    const on = proposalsOnItem(open, binderId, item.handle);
    const [mark] = on;
    return mark === undefined ? { item } : { item, proposals: on, proposal: mark };
  });
  const pending = open.flatMap((proposal): PendingRow[] =>
    proposal.kind === "create" && proposal.fields !== undefined ? [{ pending: proposal, fields: proposal.fields, link }] : [],
  );
  return [...itemRows, ...pending];
};

/** The name of a row's mark, by what it proposes. */
export const markLabel = (kind: ItemProposal["kind"]): string => (kind === "delete" ? "Delete proposed" : kind === "update" ? "Update proposed" : "New item proposed");

export const OUTSIDE_FILTER = "Outside the filter";

/** The ids of the open proposals a row shows: its create, or every one on its item. */
export const rowProposalIds = (row: Row): string[] => ("pending" in row ? [row.pending.id] : (row.proposals ?? []).map(({ id }) => id));

export const showsProposal = (row: Row, target: string): boolean => rowProposalIds(row).includes(target);
