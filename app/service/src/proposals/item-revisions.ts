// New versions of an item proposal: the agent's revision, checked as the item propose tools check a change (its
// level and locks bind it), and the user's draft, checked as the user's own write would be (no agent locks).
import { checkLevel, checkLocks, newItem } from "../items/refusals.ts";
import { TOOL } from "../items/tools.ts";
import { ItemWriteError, listed, presentValues, type ItemChange } from "../items/write.ts";
import type { StoredProposal } from "../store/store.ts";
import type { ItemProposalsOptions } from "./item-proposals.ts";
import { DraftRefused, PROPOSAL_UNCHANGED, ProposalRefused } from "./refused.ts";

type StoredItemProposal = Extract<StoredProposal, { target: "item" }>;

/** A revision's checked fields, and the item's version now (null for a create). */
export type CheckedItemRevision = { fields: Record<string, unknown>; version: string | null };

export type ItemRevisions = {
  /** Checks fields replacing `stored`'s as its agent proposes them; throws the agent's refusal. Stores nothing. */
  checkItemRevision(stored: StoredItemProposal, fields: Record<string, unknown>): Promise<CheckedItemRevision>;
  /** Checks fields replacing `stored`'s as the user's draft; throws DraftRefused. Stores nothing. */
  checkItemDraft(stored: StoredItemProposal, fields: Record<string, unknown>): Promise<void>;
};

const NO_FIELDS = "A delete proposal has no fields to change.";

/** A create's fields split into the new item's input (its file kept from the proposal) and its properties. */
const createInput = (stored: StoredItemProposal, fields: Record<string, unknown>) => {
  const { title, body, ...properties } = fields;
  // The writer checks the title's and body's types.
  const input = { title: title as string, ...(body === undefined ? {} : { body: body as string }), ...(stored.file === null ? {} : { file: stored.file }) };
  return { input, properties };
};

export const itemRevisions = ({
  catalog,
  writer,
  viewOf,
  structureFor,
  checkStructure,
  linksToIds,
  agentWriteError,
}: Pick<ItemProposalsOptions, "catalog" | "writer" | "viewOf" | "structureFor" | "checkStructure" | "linksToIds" | "agentWriteError">): ItemRevisions => {
  const checkItemRevision = async (stored: StoredItemProposal, fields: Record<string, unknown>): Promise<CheckedItemRevision> => {
    if (stored.kind === "delete") {
      throw new ProposalRefused(
        `${NO_FIELDS} ${PROPOSAL_UNCHANGED} To keep the item, ask the user to reject the proposal; to still delete it after a conflict, ` +
          `read it with ${TOOL.getItem} and call ${TOOL.proposeDelete} again on the item as it is now.`,
      );
    }
    const current = viewOf(await catalog.snapshot());
    const structure = structureFor(current, stored.structure);
    checkLevel(structure, "propose", stored.kind);
    if (stored.kind === "create") {
      const { input, properties } = createInput(stored, fields);
      checkLocks(structure, "create", Object.keys(properties));
      const linked = presentValues(linksToIds(current, structure, properties));
      checkStructure(current, structure);
      try {
        await writer.check({ kind: "create", structureId: structure.id, item: newItem(input, linked), unseen: current.hiddenFolders });
      } catch (error) {
        throw agentWriteError(current, error, { structure });
      }
      return { fields: { title: input.title, ...(input.body === undefined ? {} : { body: input.body }), ...linked }, version: null };
    }
    const item = current.items.find((candidate) => candidate.id === stored.itemId);
    if (item?.handle == null || item.structure !== stored.structure) {
      throw new ProposalRefused(`The item this proposal changes is gone, or moved to another structure. Read it again and propose anew. ${PROPOSAL_UNCHANGED}`);
    }
    checkLocks(structure, "update", Object.keys(fields));
    checkStructure(current, structure);
    const linked = linksToIds(current, structure, fields);
    try {
      await writer.check({ kind: "update", handle: item.handle, fields: linked, baseVersion: item.version });
    } catch (error) {
      throw agentWriteError(current, error, { handle: item.handle, structure });
    }
    return { fields: linked, version: item.version };
  };

  /** The writer's dry run of the draft as a change of the item as it is now. */
  const draftChange = async (stored: StoredItemProposal, fields: Record<string, unknown>): Promise<ItemChange> => {
    if (stored.kind === "delete") throw new DraftRefused(`${NO_FIELDS} Approve or reject it instead.`);
    if (stored.kind === "create") {
      const { input, properties } = createInput(stored, fields);
      return { kind: "create", structureId: stored.structure, item: newItem(input, properties) };
    }
    const item = (await catalog.snapshot()).items.find((candidate) => candidate.id === stored.itemId);
    if (item?.handle == null) throw new DraftRefused("The item this proposal changes is gone, so there is nothing to edit. Reject the proposal.");
    return { kind: "update", handle: item.handle, fields, baseVersion: item.version };
  };

  const checkItemDraft = async (stored: StoredItemProposal, fields: Record<string, unknown>) => {
    const change = await draftChange(stored, fields);
    try {
      await writer.check(change);
    } catch (error) {
      if (!(error instanceof ItemWriteError)) throw error;
      const why = error.problems.length > 0 ? listed(error.problems) : error.message;
      throw new DraftRefused(`Your edit can't be saved: ${why}. Fix it and save again; the version saved before stays.`);
    }
  };

  return { checkItemRevision, checkItemDraft };
};
