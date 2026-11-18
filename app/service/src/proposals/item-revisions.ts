// New versions of an item proposal: the agent's revision, checked as the item propose tools check a change (its
// level and locks bind it), and the user's draft, checked as the user's own write would be (no agent locks).
import { isDeepStrictEqual } from "node:util";

import { viewOf } from "../items/agent-view.ts";
import { newItem } from "../items/refusals.ts";
import { TOOL } from "../items/tools.ts";
import { ItemWriteError, listed, type ItemChange } from "../items/write.ts";
import { awaitsNewVersion } from "../store/proposal-rules.ts";
import type { ItemChecks, ItemProposalsOptions } from "./item-proposals.ts";
import { createInputOf, targetItem, type StoredItemProposal } from "./item-target.ts";
import { ASK_TO_REJECT, DraftRefused, PROPOSAL_UNCHANGED, ProposalRefused } from "./refused.ts";

/** A revision's checked fields, and the proposal's new base: the item's version now (null for a create); undefined keeps it. */
type CheckedItemRevision = { fields: Record<string, unknown>; baseVersion?: string | null };

export type ItemRevisions = {
  /**
   * Checks fields replacing `proposed`, the fields of `stored`'s current version, as its agent proposes them; throws
   * the agent's refusal. Stores nothing.
   */
  checkItemRevision(stored: StoredItemProposal, fields: Record<string, unknown>, proposed: Record<string, unknown>): Promise<CheckedItemRevision>;
  /** Checks fields replacing `stored`'s as the user's draft; throws DraftRefused. Stores nothing. */
  checkItemDraft(stored: StoredItemProposal, fields: Record<string, unknown>): Promise<void>;
};

type ItemRevisionsOptions = Pick<ItemProposalsOptions, "catalog" | "writer"> & { checks: ItemChecks };

const NO_FIELDS = "A delete proposal has no fields to change.";

/** For a binder the agent may not see now (hidden, gone or broken settings) as for a gone item: it names neither. */
const UNREACHABLE = `The item this proposal changes, or the binder it adds one to, can't be reached anymore, so the proposal can't be revised. ${PROPOSAL_UNCHANGED} Tell the user, and ${ASK_TO_REJECT}.`;

const SAME_FIELDS = `The fields are the same as your proposal's current ones, so they change nothing. ${PROPOSAL_UNCHANGED}`;

export const itemRevisions = ({ catalog, writer, checks }: ItemRevisionsOptions): ItemRevisions => {
  /** `fields` checked as a change of the target as it is now, and the item's version now (null for a create). */
  const checkedOnNow = async (stored: StoredItemProposal, fields: Record<string, unknown>): Promise<{ fields: Record<string, unknown>; version: string | null }> => {
    const current = viewOf(await catalog.snapshot());
    const binder = current.binders.get(stored.binder);
    if (binder === undefined) throw new ProposalRefused(UNREACHABLE);
    if (stored.kind === "create") return { fields: await checks.checkedCreate(current, binder, createInputOf(fields, stored.file).input), version: null };
    const target = targetItem(current.items, stored);
    if (target === "gone" || "movedTo" in target) {
      throw new ProposalRefused(`The item this proposal changes is gone, or moved to another binder. Read it again and propose anew. ${PROPOSAL_UNCHANGED}`);
    }
    return { fields: await checks.checkedUpdate(current, binder, target.handle, fields, target.item.version), version: target.item.version };
  };

  /** A conflict's revision is based on the item as it is now; a pending one keeps its base and must change its fields. */
  const checkItemRevision = async (stored: StoredItemProposal, fields: Record<string, unknown>, proposed: Record<string, unknown>): Promise<CheckedItemRevision> => {
    if (stored.kind === "delete") {
      throw new ProposalRefused(
        `${NO_FIELDS} ${PROPOSAL_UNCHANGED} To keep the item, ask the user to reject the proposal; to still delete it after a conflict, ` +
          `read it with ${TOOL.getItem} and call ${TOOL.proposeDelete} again on the item as it is now.`,
      );
    }
    const checked = await checkedOnNow(stored, fields);
    const rebased = awaitsNewVersion(stored.status);
    if (!rebased && isDeepStrictEqual(checked.fields, proposed)) throw new ProposalRefused(SAME_FIELDS);
    return { fields: checked.fields, ...(rebased ? { baseVersion: checked.version } : {}) };
  };

  /** The writer's dry run of the draft as a change of the item as it is now. */
  const draftChange = async (stored: StoredItemProposal, fields: Record<string, unknown>): Promise<ItemChange> => {
    if (stored.kind === "delete") throw new DraftRefused(`${NO_FIELDS} Approve or reject it instead.`);
    if (stored.kind === "create") {
      const { input } = createInputOf(fields, stored.file);
      return { kind: "create", binderId: stored.binder, item: newItem(input, input.properties) };
    }
    const target = targetItem((await catalog.snapshot()).items, stored);
    if (target === "gone") throw new DraftRefused("The item this proposal changes is gone, so there is nothing to edit. Reject the proposal.");
    if ("movedTo" in target) throw new DraftRefused("The item this proposal changes moved to another binder, so the proposal can't be approved. Reject the proposal.");
    return { kind: "update", handle: target.handle, fields, baseVersion: target.item.version };
  };

  const checkItemDraft = async (stored: StoredItemProposal, fields: Record<string, unknown>) => {
    const change = await draftChange(stored, fields);
    try {
      await writer.check(change);
    } catch (error) {
      if (!(error instanceof ItemWriteError)) throw error;
      const why = error.problems.length > 0 ? listed(error.problems) : error.message;
      throw new DraftRefused(`Your edit can't be saved: ${why}. Fix it and save again; the version saved before stays.`, error.problems);
    }
  };

  return { checkItemRevision, checkItemDraft };
};
