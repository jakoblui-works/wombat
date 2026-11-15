// What an approve and a target's write hand each other, for every target.
import { errorCode, isAlreadyThere, isMissingPath } from "@wombat/shared/errno";
import type { Problem } from "@wombat/shared/items";
import type { FileProposalKind } from "@wombat/shared/proposals";

import { NoHardLinks } from "../items/files.ts";
import type { VersionAuthor } from "../store/proposal-rules.ts";
import type { ProposalContent, StoredProposal } from "../store/store.ts";

/** The named points of an approve, for a caller that must act exactly there (the crash tests stop the process). */
export const APPROVE_STEPS = ["after_applying_commit", "after_write"] as const;
export type ApproveStep = (typeof APPROVE_STEPS)[number];

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
type Intent = { intent: unknown; itemHandle?: string | null };

/**
 * What an approve needs from a target: the intent of its write, the write (of a version by `by`), and whether a
 * write with that intent landed.
 */
export type ApplyTarget = {
  intentOf: (stored: StoredProposal, content: ProposalContent) => Promise<Intent>;
  write: (stored: StoredProposal, content: ProposalContent, by: VersionAuthor) => Promise<Applied>;
  written: (stored: StoredProposal) => Promise<Written | undefined>;
};

/** Nothing written, with the problem the user reads on the proposal; `field` names the field it's about. */
export const conflict = (message: string, field?: string): Applied => ({ problem: { ...(field === undefined ? {} : { field }), message } });

export const NOTHING_WRITTEN = "so nothing was written";

/** What the user can do about a proposal the target changed under: `what` is the target ("file", "item"). */
export const askAgain = (what: string) => `Reject the proposal, or ask the agent to read the ${what} again and propose anew.`;

export const BY_HAND = "Make the change by hand if you still want it, or reject the proposal.";

export const ASK_AGAIN_FILE = askAgain("file");

export const FILE_EXISTS = conflict(`A file was made at this path since the agent proposed creating it, ${NOTHING_WRITTEN}. ${ASK_AGAIN_FILE}`);
export const FILE_GONE = conflict(`The file was deleted or moved since the agent read it, ${NOTHING_WRITTEN}. ${ASK_AGAIN_FILE}`);

/** A target state the user can fix: the proposal stays pending, to approve again as it is. */
const retry = (message: string): Applied => ({ retry: { message } });

const FOLDER_GONE = retry(`The folder of this file doesn't exist anymore, ${NOTHING_WRITTEN}. Create the folder and approve again, or reject the proposal.`);
const UNREADABLE = retry(
  `The service isn't allowed to read the file or its folder, ${NOTHING_WRITTEN}. Make them readable for the service and approve again, or reject the proposal.`,
);
const READ_ONLY = retry(
  `The file is read-only for the service (its permissions, or a read-only filesystem), ${NOTHING_WRITTEN}. Make it writable and approve again, or reject the proposal.`,
);
const UNWRITABLE = retry(
  `The service isn't allowed to write in the file's folder (its permissions, or a read-only filesystem), ${NOTHING_WRITTEN}. Make the folder writable and approve again, or reject the proposal.`,
);
const NO_HARD_LINKS = conflict(
  `The filesystem of the file's folder can't create a file without risking to replace one made meanwhile (it has no hard links), ${NOTHING_WRITTEN}. Create the file by hand, or reject the proposal.`,
);

const NO_ACCESS = new Set(["EACCES", "EPERM", "EROFS"]);

/** Where touching the target failed: reading it, checking the file may be written, or writing it. */
export type Step = "read" | "check" | "write";

/**
 * What an expected failure at `step` (the target's state, not the service's) settles to: a retry once the user fixed
 * the target, or a conflict; undefined for an unexpected failure.
 */
export const failureOutcome = (error: unknown, kind: FileProposalKind, step: Step): Applied | undefined => {
  if (error instanceof NoHardLinks) return NO_HARD_LINKS;
  if (kind === "create" && isAlreadyThere(error)) return FILE_EXISTS;
  if (isMissingPath(error)) return kind === "create" ? FOLDER_GONE : FILE_GONE;
  if (!NO_ACCESS.has(errorCode(error))) return undefined;
  return step === "read" ? UNREADABLE : step === "check" ? READ_ONLY : UNWRITABLE;
};
