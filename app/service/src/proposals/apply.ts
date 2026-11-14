// What an approve and a target's write hand each other, for every target.
import type { Problem } from "@wombat/shared/items";

import type { ProposalContent, StoredProposal } from "../store/store.ts";

/** The named points of an approve, for a caller that must act exactly there (the crash tests stop the process). */
export type ApproveStep = "after_applying_commit" | "after_write";

/**
 * What a target's write did: written; nothing written, with the problem (a conflict); nothing written, because of
 * the target's state the user can fix without changing the proposal (`retry`: approve the same version again once
 * fixed); or nothing written, with a new version for the user to approve instead, based on the target as it is now.
 */
export type Applied =
  | { written: true }
  | { problem: Problem }
  | { retry: Problem }
  | { revised: { content: ProposalContent; baseVersion: string | null } };

/** What an approve needs from a target: its write, and whether a write with this intent landed. */
export type ApplyTarget = {
  intentOf: (content: ProposalContent) => unknown;
  write: (stored: StoredProposal, content: ProposalContent) => Promise<Applied>;
  written: (stored: StoredProposal) => Promise<boolean>;
};
