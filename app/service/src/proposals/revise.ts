// New versions of an open proposal: the agent's revision (the revise_proposal tool) and the user's draft (my version
// on top of the agent's latest). Each runs in the decide queue, so it never interleaves with an approve or a reject.
import { MAX_PROPOSAL_VERSIONS, myDraft, ProposalErrorCode, sameAsAgents, type DraftRequest, type FileProposal } from "@wombat/shared/proposals";

import { currentVersion, draftSlot } from "../store/proposal-rules.ts";
import { fieldsOf } from "../store/proposals.ts";
import type { ProposalChange, ProposalContent, Store, StoredProposal } from "../store/store.ts";
import type { DistributiveOmit } from "../store/values.ts";
import { checkText, textProblemClause } from "./file-target.ts";
import type { ItemProposalRecord, ItemProposals } from "./item-proposals.ts";
import { heldIn, reviseFile, type Revision } from "./propose-file.ts";
import {
  DraftRefused,
  itemsNotConfiguredForAgent,
  itemsNotConfiguredIn,
  notOwnOpenProposal,
  ownOpenProposal,
  PROPOSAL_UNCHANGED,
  ProposalError,
  ProposalRefused,
  toDraft,
  workspaceFolder,
} from "./refused.ts";

/** My draft as the route takes it: a file's whole text, or an item's fields. */
type DraftContent = DistributiveOmit<DraftRequest, "onVersion">;

/** `rebuilt`: the version was made on the file or item as it is now, so it holds only this revision's changes. */
export type RevisedResult = { revised: string; version: number; rebuilt?: true };

/** What the agent is told with a rebuilt version, so it doesn't take it for an extension of its earlier ones. */
export const REBUILT =
  "The proposal was a conflict, so this version was rebuilt on the file or item as it is now: it holds only this revision's changes, none of your earlier versions'.";

/** A new version and the proposal's new base (undefined keeps it). */
type NextVersion = { content: ProposalContent; baseVersion?: string | null };

/** Whether a revision was rebuilt on the target as it is now: its new base is a version read from the target. */
const isRebuilt = (next: NextVersion) => typeof next.baseVersion === "string";

/** The refusal of an agent's revise of a proposal with `count` versions stored, or undefined while it may have another. */
const versionCapRefusal = (count: number): string | undefined =>
  count < MAX_PROPOSAL_VERSIONS
    ? undefined
    : `This proposal has ${String(count)} versions, the most one proposal may have. ${PROPOSAL_UNCHANGED} ` +
      "Ask the user to decide on it as it is, or to reject it so you can propose anew.";

/** The refusal of a draft equal to the agent's version; with an edit of mine current, how to show the agent's version again. */
const sameAsAgentsRefusal = (draftCurrent: boolean) =>
  `Your version is the same as the agent's, so there is nothing to save.${draftCurrent ? " To show the agent's version again, drop your edit." : ""}`;

/** Which change an item proposal's revise asked for, or the refusal when it isn't `fields` alone. */
const itemRevisionOf = ({ edits, content, fields }: Revision): { fields: Record<string, unknown> } | { refusal: string } => {
  if (edits !== undefined || content !== undefined) {
    return { refusal: `This is an item proposal, so it takes no edits or content: send fields, the fields it should set instead. ${PROPOSAL_UNCHANGED}` };
  }
  if (fields === undefined) return { refusal: `Send fields, the fields the proposal should set instead of the ones it sets now. ${PROPOSAL_UNCHANGED}` };
  return { fields };
};

/** Why my draft doesn't fit the proposal's target, or undefined when it does. */
const draftShapeRefusal = (target: StoredProposal["target"], content: DraftContent): string | undefined => {
  if (target === "file" && !("text" in content)) return "This is a file proposal: send its whole text as text, not fields.";
  if (target === "item" && !("fields" in content)) return "This is an item proposal: send its fields, not text.";
  return undefined;
};

const draftChanged = (id: string, onVersion: number) =>
  new ProposalError(
    ProposalErrorCode.enum.proposal_changed,
    `Version ${String(onVersion)} isn't the agent's latest version of proposal ${id}. Refresh the proposal and edit its current version.`,
  );

/** The revise refusal for an item proposal whose workspace, at `folder`, has no items folder now. */
const itemsGone = (folder: string) => `${itemsNotConfiguredForAgent(folder)} Your item proposal can't be revised until then. ${PROPOSAL_UNCHANGED}`;

type ReviserOptions = {
  store: Store;
  /** Runs a job in the queue approve and reject run in. */
  decide: <T>(job: () => Promise<T>) => Promise<T>;
  /** Announces a committed change and returns the proposal. */
  committed: (id: string, change: ProposalChange | undefined) => StoredProposal;
  /** A workspace's item side, while it has an items folder. */
  itemsOf: ((workspaceId: string) => ItemProposals | undefined) | undefined;
  /** Whether the items catalog of the workspace or of any listed one holds a file; undefined without items. */
  holds: ((realPath: string, workspaceId: string) => Promise<boolean>) | undefined;
  summaryOf: (stored: StoredProposal) => Promise<FileProposal | ItemProposalRecord>;
};

export const reviser = ({ store, decide, committed, itemsOf, holds, summaryOf }: ReviserOptions) => {
  const currentOf = (id: string) => {
    const n = currentVersion(store.listVersionHeads(id))?.n;
    const current = n === undefined ? undefined : store.getVersion(id, n);
    if (current === undefined) throw new Error(`Proposal ${id} has no version stored.`);
    return current;
  };

  const nextVersion = async (stored: StoredProposal, revision: Revision): Promise<NextVersion> => {
    const current = currentOf(stored.id);
    if (stored.target === "file") return reviseFile(stored, current, revision, heldIn(holds, stored.workspace));
    const asked = itemRevisionOf(revision);
    if ("refusal" in asked) throw new ProposalRefused(asked.refusal);
    const items = itemsOf?.(stored.workspace);
    if (items === undefined) throw new ProposalRefused(itemsGone(workspaceFolder(store, stored.workspace)));
    const { fields, ...based } = await items.checkItemRevision(stored, asked.fields, fieldsOf(current.content));
    return { content: { fields }, ...based };
  };

  /**
   * `agentId`'s new version of its open proposal `id`; throws ProposalRefused. Not counted toward the open proposals'
   * cap (no new proposal); refused at MAX_PROPOSAL_VERSIONS.
   */
  const revise = (agentId: string, id: string, reason: string, revision: Revision): Promise<RevisedResult> =>
    decide(async () => {
      const stored = ownOpenProposal(store, agentId, id);
      if (stored === undefined) throw notOwnOpenProposal(id);
      const full = versionCapRefusal(store.listVersionHeads(id).length);
      if (full !== undefined) throw new ProposalRefused(full);
      const next = await nextVersion(stored, revision);
      committed(id, store.addAgentVersion(id, next.content, reason, next.baseVersion));
      return { revised: id, version: currentVersion(store.listVersionHeads(id))?.n ?? 0, ...(isRebuilt(next) ? { rebuilt: true as const } : {}) };
    });

  /** The draft's content once it passed its checks; throws DraftRefused. */
  const checkedDraft = async (stored: StoredProposal, onVersion: number, content: DraftContent): Promise<ProposalContent> => {
    const theirs = store.getVersion(stored.id, onVersion);
    if (theirs !== undefined && sameAsAgents(content, theirs.content)) throw new DraftRefused(sameAsAgentsRefusal(myDraft(store.listVersionHeads(stored.id)) !== undefined));
    if ("text" in content) {
      const checked = checkText(content.text);
      if ("problem" in checked) throw new DraftRefused(`${textProblemClause(checked.problem, "The text")}. Change it and save again.`);
      return { text: checked.text };
    }
    if (stored.target === "item") {
      const items = itemsOf?.(stored.workspace);
      if (items === undefined) throw itemsNotConfiguredIn(store, stored.workspace);
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
      const checked = await checkedDraft(toDraftOn(id, onVersion, content), onVersion, content);
      toDraftOn(id, onVersion, content);
      return summaryOf(committed(id, store.putDraft(id, onVersion, checked)));
    });

  /** Drops my current draft: the agent's version is current again. */
  const clearDraft = (id: string) =>
    decide(async () => {
      toDraft(store, id);
      if (myDraft(store.listVersionHeads(id)) === undefined) {
        throw new DraftRefused(`Proposal ${id} has no edit of yours to drop: it shows the agent's version already.`);
      }
      return summaryOf(committed(id, store.clearDraft(id)));
    });

  return { revise, putDraft, clearDraft };
};
