// New versions of an open proposal: the agent's revision (the revise_proposal tool) and the user's draft (my version
// on top of the agent's latest). Each runs in the decide queue, so it never interleaves with an approve or a reject.
import { isDeepStrictEqual } from "node:util";

import { ProposalErrorCode, type FileProposal } from "@wombat/shared/proposals";

import { awaitsNewVersion, currentVersion, draftSlot } from "../store/proposal-rules.ts";
import { fieldsOf } from "../store/proposals.ts";
import type { ProposalChange, ProposalContent, Store, StoredProposal } from "../store/store.ts";
import { checkText, textProblemClause } from "./file-target.ts";
import type { ItemProposalRecord, ItemProposals } from "./item-proposals.ts";
import { reviseFile, type Revision } from "./propose-file.ts";
import { DraftRefused, itemsNotConfigured, notOwnOpenProposal, ownOpenProposal, PROPOSAL_UNCHANGED, ProposalError, ProposalRefused, toDraft } from "./refused.ts";

/** My draft as the route takes it: a file's whole text, or an item's fields. */
export type DraftContent = { text: string } | { fields: Record<string, unknown> };

export type RevisedResult = { revised: string; version: number };

/** A new version and the proposal's new base (undefined keeps it). */
type NextVersion = { content: ProposalContent; baseVersion?: string | null };

const UNREVISED = PROPOSAL_UNCHANGED;

/** Which change an item proposal's revise asked for, or the refusal when it isn't `fields` alone. */
export const itemRevisionOf = ({ edits, content, fields }: Revision): { fields: Record<string, unknown> } | { refusal: string } => {
  if (edits !== undefined || content !== undefined) {
    return { refusal: `This is an item proposal, so it takes no edits or content: send fields, the fields it should set instead. ${UNREVISED}` };
  }
  if (fields === undefined) return { refusal: `Send fields, the fields the proposal should set instead of the ones it sets now. ${UNREVISED}` };
  return { fields };
};

/** Why my draft doesn't fit the proposal's target, or undefined when it does. */
export const draftShapeRefusal = (target: StoredProposal["target"], content: DraftContent): string | undefined => {
  if (target === "file" && !("text" in content)) return "This is a file proposal: send its whole text as text, not fields.";
  if (target === "item" && !("fields" in content)) return "This is an item proposal: send its fields, not text.";
  return undefined;
};

const draftChanged = (id: string, onVersion: number) =>
  new ProposalError(
    ProposalErrorCode.enum.proposal_changed,
    `Version ${String(onVersion)} isn't the agent's latest version of proposal ${id}. Refresh the proposal and edit its current version.`,
  );

const SAME_FIELDS = `The fields are the same as your proposal's current ones, so they change nothing. ${UNREVISED}`;

const ITEMS_GONE = `The service has no items set up now, so an item proposal can't be revised. Tell the user. ${UNREVISED}`;

export type ReviserOptions = {
  store: Store;
  /** Runs a job in the queue approve and reject run in. */
  decide: <T>(job: () => Promise<T>) => Promise<T>;
  /** Announces a committed change and returns the proposal. */
  committed: (id: string, change: ProposalChange | undefined) => StoredProposal;
  items: ItemProposals | undefined;
  /** Whether the items catalog holds a file; undefined without items. */
  holds: ((realPath: string) => Promise<boolean>) | undefined;
  summaryOf: (stored: StoredProposal) => Promise<FileProposal | ItemProposalRecord>;
};

export const reviser = ({ store, decide, committed, items, holds, summaryOf }: ReviserOptions) => {
  const currentOf = (id: string) => {
    const current = currentVersion(store.listVersions(id));
    if (current === undefined) throw new Error(`Proposal ${id} has no version stored.`);
    return current;
  };

  const nextVersion = async (stored: StoredProposal, revision: Revision): Promise<NextVersion> => {
    const current = currentOf(stored.id);
    if (stored.target === "file") return reviseFile(stored, current, revision, holds);
    const asked = itemRevisionOf(revision);
    if ("refusal" in asked) throw new ProposalRefused(asked.refusal);
    if (items === undefined) throw new ProposalRefused(ITEMS_GONE);
    const { fields, version } = await items.checkItemRevision(stored, asked.fields);
    const rebased = awaitsNewVersion(stored.status);
    if (!rebased && isDeepStrictEqual(fields, fieldsOf(current.content))) throw new ProposalRefused(SAME_FIELDS);
    return { content: { fields }, ...(rebased ? { baseVersion: version } : {}) };
  };

  /** `agentId`'s new version of its open proposal `id`; throws ProposalRefused. Not counted toward the cap: no new proposal. */
  const revise = (agentId: string, id: string, reason: string, revision: Revision): Promise<RevisedResult> =>
    decide(async () => {
      const stored = ownOpenProposal(store, agentId, id);
      if (stored === undefined) throw notOwnOpenProposal(id);
      const next = await nextVersion(stored, revision);
      committed(id, store.addAgentVersion(id, next.content, reason, next.baseVersion));
      return { revised: id, version: currentOf(id).n };
    });

  /** The draft's content once it passed its checks; throws DraftRefused. */
  const checkedDraft = async (stored: StoredProposal, content: DraftContent): Promise<ProposalContent> => {
    if ("text" in content) {
      const checked = checkText(content.text);
      if ("problem" in checked) throw new DraftRefused(`${textProblemClause(checked.problem, "The text")}. Change it and save again.`);
      return { text: checked.text };
    }
    if (stored.target === "item") {
      if (items === undefined) throw itemsNotConfigured();
      await items.checkItemDraft(stored, content.fields);
    }
    return { fields: content.fields };
  };

  /** Whether my draft may go on version `onVersion` of `id` now; ProposalError or DraftRefused otherwise. */
  const toDraftOn = (id: string, onVersion: number, content: DraftContent) => {
    const stored = toDraft(store, id);
    const refusal = draftShapeRefusal(stored.target, content);
    if (refusal !== undefined) throw new DraftRefused(refusal);
    if (draftSlot(store.listVersionHeads(id), onVersion) === undefined) throw draftChanged(id, onVersion);
    return stored;
  };

  /** Saves my version on the agent's current version `onVersion`, replacing my earlier one on it. */
  const putDraft = (id: string, onVersion: number, content: DraftContent) =>
    decide(async () => {
      const checked = await checkedDraft(toDraftOn(id, onVersion, content), content);
      toDraftOn(id, onVersion, content);
      return summaryOf(committed(id, store.putDraft(id, onVersion, checked)));
    });

  /** Drops my current draft: the agent's version is current again. */
  const clearDraft = (id: string) =>
    decide(async () => {
      toDraft(store, id);
      if (currentVersion(store.listVersionHeads(id))?.by !== "me") {
        throw new DraftRefused(`Proposal ${id} has no edit of yours to drop: it shows the agent's version already.`);
      }
      return summaryOf(committed(id, store.clearDraft(id)));
    });

  return { revise, putDraft, clearDraft };
};
