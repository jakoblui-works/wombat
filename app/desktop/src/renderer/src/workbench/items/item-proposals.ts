import { isOpen, type ItemProposal, type Proposal } from "@wombat/shared/proposals";

/** An item proposal as listed, or as read on its own with its latest version's `fields` (a create shows only then). */
export type ItemProposalRead = ItemProposal & { fields?: Readonly<Record<string, unknown>> };

export const oldestFirst = (a: Proposal, b: Proposal): number => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The proposals of workspace `ws`; none while `ws` is undefined. */
export const ofWorkspace = <P extends { workspace: string }>(proposals: readonly P[], ws: string | undefined): P[] => proposals.filter((p) => p.workspace === ws);

/** The binder's open item proposals, oldest first. */
export const openItemProposals = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string): Extract<P, { target: "item" }>[] =>
  proposals.filter((p): p is Extract<P, { target: "item" }> => p.target === "item" && p.binder === binderId && isOpen(p.status)).sort(oldestFirst);

/** An item proposal that changes an item already there. */
export type ItemChange<P> = Extract<P, { target: "item" }> & { kind: "update" | "delete" };

/** The open updates and deletes proposed on the item with `handle` in the binder, oldest first. */
export const proposalsOnItem = <P extends Proposal | ItemProposalRead>(proposals: readonly P[], binderId: string, handle: string | null): ItemChange<P>[] =>
  handle === null ? [] : openItemProposals(proposals, binderId).filter((p): p is ItemChange<P> => p.kind !== "create" && p.handle === handle);
