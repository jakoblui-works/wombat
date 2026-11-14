// What an approve and a target's write hand each other, for every target.
import type { Problem } from "@wombat/shared/items";

import type { ProposalContent, StoredProposal } from "../store/store.ts";

/** The named points of an approve, for a caller that must act exactly there (the crash tests stop the process). */
export type ApproveStep = "after_applying_commit" | "after_write";

/** A write that landed; `itemId` and `itemHandle` name the item a create made. */
export type Written = { written: true; itemId?: string; itemHandle?: string };

/**
 * What a target's write did: written; nothing written, with the problem (a conflict); nothing written, because of
 * the target's state the user can fix without changing the proposal (`retry`: approve the same version again once
 * fixed); or nothing written, with a new version for the user to approve instead, based on the target as it is now.
 */
export type Applied = Written | { problem: Problem } | { retry: Problem } | { revised: { content: ProposalContent; baseVersion: string | null } };

/**
 * What the applying commit stores: the write's intent, and the target item's handle while the item still exists
 * (a delete's item is gone once written, and the proposal keeps answering its handle).
 */
export type Intent = { intent: unknown; itemHandle?: string | null };

/** What an approve needs from a target: the intent of its write, the write, and whether a write with that intent landed. */
export type ApplyTarget = {
  intentOf: (stored: StoredProposal, content: ProposalContent) => Promise<Intent>;
  write: (stored: StoredProposal, content: ProposalContent) => Promise<Applied>;
  written: (stored: StoredProposal) => Promise<Written | undefined>;
};
