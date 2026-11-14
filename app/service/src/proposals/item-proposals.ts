// The item side of proposals: the checks a proposed item change runs before anything is stored (the direct change's,
// in its order), the item target an approve writes through, and item proposals as people read them. Approving
// applies a proposal through the writer on the version the agent read, under the structure's settings as they are
// now; anything changed since makes it a conflict, never an overwrite.
import { randomUUIDv7 } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { ItemWriteErrorCode } from "@wombat/shared/api";
import { isMissing } from "@wombat/shared/errno";
import type { Item } from "@wombat/shared/items";
import type { ItemProposal, ProposalVersion } from "@wombat/shared/proposals";

import type { View } from "../items/access.ts";
import { handlesById, withLinks } from "../items/api-view.ts";
import type { Catalog, LoadedItem, LoadedStructure, Snapshot, ValidStructure } from "../items/catalog.ts";
import { checkHasId, checkLevel, checkLocks, lockedNames, newItem, type Family, type ItemInput } from "../items/refusals.ts";
import { SETTINGS_FILE } from "../items/structures.ts";
import { ItemWriteError, presentValues, type Writer } from "../items/write.ts";
import type { NewProposal, ProposalContent, Store, StoredProposal } from "../store/store.ts";
import type { Applied, ApplyTarget, Written } from "./apply.ts";
import { failureOutcome } from "./file-target.ts";
import { commonFields } from "./proposal-fields.ts";

export type ProposalResult = { proposed: string };

/** An item proposal as sent, with what its current version proposes, for the service's own callers. */
export type ItemProposalRecord = ItemProposal & { fields: Record<string, unknown>; baseVersion: string | null };

export type ItemProposalDetail = ItemProposalRecord & { current: Item | null; versions: ProposalVersion[] };

export type StoredItemProposal = Extract<StoredProposal, { target: "item" }>;

/** A proposed item change as the item tools take it. */
export type ProposedItemChange =
  | { kind: "create"; structure: string; input: ItemInput }
  | { kind: "update"; handle: string; fields: Record<string, unknown>; version: string }
  | { kind: "delete"; handle: string; version: string };

/** An item proposal that passed its checks: what to store, and its first version's fields. */
export type CheckedItemProposal = { proposal: Extract<NewProposal, { target: "item" }>; fields: Record<string, unknown> };

export type ItemProposals = {
  /** Runs `change`'s checks as `agentId` proposes it; throws the agent's refusal. Stores nothing. */
  checkItemProposal(agentId: string, change: ProposedItemChange, reason: string): Promise<CheckedItemProposal>;
  /** For people (HTTP): the stored item proposals as sent, each with its item's handle now, or the one it had. */
  itemProposalsOf(stored: readonly StoredItemProposal[]): Promise<ItemProposalRecord[]>;
  /** As `itemProposalsOf`, with its item as it is now (null when gone), version `n`'s fields and every version. */
  itemProposalDetail(stored: StoredItemProposal, n: number): Promise<ItemProposalDetail>;
  /** What an approve writes an item proposal through. */
  itemTarget: ApplyTarget;
};

/** The view functions come from access.ts, which alone decides what an agent may read about a structure. */
export type ItemProposalsOptions = {
  catalog: Catalog;
  writer: Writer;
  store: Store;
  viewOf: (snapshot: Snapshot) => View;
  structureFor: (view: View, id: string) => ValidStructure;
  itemFor: (view: View, handle: string) => { item: LoadedItem; structure: ValidStructure; handle: string };
  checkStructure: (view: View, structure: ValidStructure) => void;
  linksToIds: (view: View, structure: ValidStructure, values: Record<string, unknown>) => Record<string, unknown>;
  checkNewFile: (view: View, structure: ValidStructure, file: unknown, family: Family) => Promise<void>;
  agentWriteError: (view: View, error: unknown, subject: { handle?: string; structure: ValidStructure }) => unknown;
};

/**
 * What an item approve's applying commit stores: a create's new id; an update's resulting file version; a delete's
 * item file (relative to the root; null when the item wasn't there to delete).
 */
type ItemIntent = { itemId?: string | null; version?: string | null; path?: string | null };

/** What a written check reads of the items now: the items, whether the proposal's structure was read whole, whether a delete's file is missing on disk. */
export type ItemsNow = { items: readonly LoadedItem[]; structureRead: boolean; fileMissing: boolean };

/** Whether a structure was read whole: it has settings, and no folder of it failed to read (its only problems without a field). */
export const structureRead = (structures: readonly LoadedStructure[], id: string) =>
  structures.some((structure) => structure.id === id && structure.problems.every((problem) => problem.field !== undefined));

const itemOnly = (stored: StoredProposal): StoredItemProposal => {
  if (stored.target !== "item") throw new Error(`Proposal ${stored.id} isn't an item proposal; it can't be handled as one.`);
  return stored;
};

const fieldsOf = (id: string, content: ProposalContent) => {
  if (!("fields" in content)) throw new Error(`Proposal ${id}'s version holds no item fields; it can't be read.`);
  return content.fields;
};

const itemById = (items: readonly LoadedItem[], id: string | null | undefined) => (id == null ? undefined : items.find((item) => item.id === id));

/**
 * Whether the write `intent` describes is what the items hold now: the created item exists, the update's version is
 * there, the deleted item's file is gone. Throws when a create's structure wasn't read whole: an item missing from
 * it may still have been made, and settling it pending would let a second approve make another.
 */
export const itemWritten = (stored: StoredItemProposal, now: ItemsNow): Written | undefined => {
  const intent = (stored.intent ?? {}) as ItemIntent;
  if (stored.kind === "create") {
    if (!now.structureRead) throw new Error(`Proposal ${stored.id}'s structure can't be read whole, so whether its item was made can't be told.`);
    const made = itemById(now.items, intent.itemId);
    return made?.id == null ? undefined : { written: true, itemId: made.id, ...(made.handle === null ? {} : { itemHandle: made.handle }) };
  }
  if (stored.kind === "delete") return intent.path != null && now.fileMissing ? { written: true } : undefined;
  const item = itemById(now.items, stored.itemId);
  return item !== undefined && intent.version != null && item.version === intent.version ? { written: true } : undefined;
};

/** Whether nothing is at `path` on disk; any other failure to tell throws. */
const missing = async (path: string) => {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }
};

const conflict = (message: string, field?: string): Applied => ({ problem: { ...(field === undefined ? {} : { field }), message } });

const ITEM_GONE = conflict("The item was deleted, or its id changed by hand, since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again.");

const ITEM_CHANGED = conflict(
  "The item changed (edited, renamed or deleted) since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again and propose anew.",
);

/** What a failed item write settles to: a conflict for what changed, a retry for a target the user can fix; undefined for the unexpected. */
const writeFailure = (error: unknown, stored: StoredItemProposal): Applied | undefined => {
  if (!(error instanceof ItemWriteError)) return failureOutcome(error, stored.kind === "create" ? "create" : "edit", "write");
  if (error.code === ItemWriteErrorCode.enum.stale_version || error.code === ItemWriteErrorCode.enum.item_not_found) return ITEM_CHANGED;
  if (error.code === ItemWriteErrorCode.enum.items_not_writable) {
    return conflict(`${error.message} Nothing was applied: keep the items root on a local filesystem and ask the agent to propose again, or reject the proposal.`);
  }
  const [only] = error.problems;
  return conflict(error.message, error.problems.length === 1 ? only?.field : undefined);
};

export const openItemProposals = ({
  catalog,
  writer,
  store,
  viewOf,
  structureFor,
  itemFor,
  checkStructure,
  linksToIds,
  checkNewFile,
  agentWriteError,
}: ItemProposalsOptions): ItemProposals => {
  const view = async () => viewOf(await catalog.snapshot());

  const checkCreate = async (agentId: string, structureId: string, input: ItemInput, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const structure = structureFor(current, structureId);
    checkLevel(structure, "propose", "create");
    const properties = input.properties ?? {};
    checkLocks(structure, "create", Object.keys(properties));
    const linked = presentValues(linksToIds(current, structure, properties));
    checkStructure(current, structure);
    await checkNewFile(current, structure, input.file, "propose");
    try {
      await writer.check({ kind: "create", structureId: structure.id, item: newItem(input, linked), unseen: current.hiddenFolders });
    } catch (error) {
      throw agentWriteError(current, error, { structure });
    }
    return {
      proposal: { target: "item", path: null, structure: structure.id, itemId: null, kind: "create", file: input.file ?? null, reason, baseVersion: null, agentId },
      fields: { title: input.title, ...(input.body === undefined ? {} : { body: input.body }), ...linked },
    };
  };

  const checkUpdate = async (agentId: string, handle: string, fields: Record<string, unknown>, version: string, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const { item, structure, handle: target } = itemFor(current, handle);
    checkLevel(structure, "propose", "update");
    checkLocks(structure, "update", Object.keys(fields));
    checkStructure(current, structure);
    const linked = linksToIds(current, structure, fields);
    try {
      await writer.check({ kind: "update", handle: target, fields: linked, baseVersion: version });
    } catch (error) {
      throw agentWriteError(current, error, { handle, structure });
    }
    return {
      proposal: { target: "item", path: null, structure: structure.id, itemId: item.id, kind: "update", file: null, reason, baseVersion: version, agentId },
      fields: linked,
    };
  };

  const checkDelete = async (agentId: string, handle: string, version: string, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const { item, structure, handle: target } = itemFor(current, handle);
    checkLevel(structure, "propose", "delete");
    checkStructure(current, structure);
    checkHasId(item, target);
    try {
      await writer.check({ kind: "delete", handle: target, baseVersion: version });
    } catch (error) {
      throw agentWriteError(current, error, { handle, structure });
    }
    return {
      proposal: { target: "item", path: null, structure: structure.id, itemId: item.id, kind: "delete", file: null, reason, baseVersion: version, agentId },
      fields: {},
    };
  };

  const currentVersion = (id: string) => {
    const versions = store.listVersions(id);
    const latest = versions.at(-1);
    if (latest === undefined) throw new Error(`Proposal ${id} has no version stored; it can't be read.`);
    return { fields: fieldsOf(id, latest.content), versions };
  };

  /** A stored proposal with its item's handle now, or the one the applying commit stored (people see hidden structures too). */
  const proposalOf = (stored: StoredItemProposal, items: readonly LoadedItem[]): ItemProposalRecord => {
    const { fields, versions } = currentVersion(stored.id);
    return {
      ...commonFields(stored, versions),
      target: "item",
      structure: stored.structure,
      kind: stored.kind,
      handle: itemById(items, stored.itemId)?.handle ?? stored.itemHandle ?? null,
      file: stored.file,
      fields,
      baseVersion: stored.baseVersion,
    };
  };

  /** Applies a proposal, or says why it can't be: what changed since the agent read the item. */
  const write = async (stored: StoredItemProposal, fields: Record<string, unknown>): Promise<Applied> => {
    const snapshot = await catalog.snapshot();
    const current = viewOf(snapshot);
    const structure = current.structures.get(stored.structure);
    const access = current.hiddenStructures.has(stored.structure) ? "hidden" : structure?.settings.access;
    if (access === "hidden" || access === "read") {
      return conflict(`${stored.structure} is now ${access}, so agents' changes no longer apply to it and nothing was applied. Make the change by hand if you still want it.`, "access");
    }
    if (structure === undefined) {
      return conflict(`The structure ${stored.structure} is gone, or its ${SETTINGS_FILE} is broken, so nothing was applied. Fix its settings and ask the agent again, or reject the proposal.`);
    }
    const locked = lockedNames(structure, stored.kind, Object.keys(fields));
    if (locked.length > 0) {
      return conflict(`${locked.join(", ")} became locked in ${stored.structure}, so nothing was applied. Make the change by hand if you still want it.`, locked[0]);
    }

    try {
      if (stored.kind === "create") {
        const { title, body, ...properties } = fields;
        const input = { title: title as string, ...(typeof body === "string" ? { body } : {}), ...(stored.file === null ? {} : { file: stored.file }) };
        const { itemId } = (stored.intent ?? {}) as ItemIntent;
        const created = await writer.createItem(structure.id, newItem(input, properties), itemId ?? undefined);
        return created.id === null ? { written: true } : { written: true, itemId: created.id, ...(created.handle === null ? {} : { itemHandle: created.handle }) };
      }
      const item = itemById(snapshot.items, stored.itemId);
      if (item?.handle == null || (stored.kind === "delete" && ((stored.intent ?? {}) as ItemIntent).path == null)) return ITEM_GONE;
      if (item.structure !== stored.structure) return conflict(`The item moved to ${item.structure} since the agent read it, so nothing was applied. Reject the proposal, or ask the agent again.`);
      const baseVersion = stored.baseVersion ?? "";
      if (stored.kind === "update") await writer.updateItem(item.handle, fields, baseVersion);
      else await writer.deleteItem(item.handle, baseVersion);
      return { written: true };
    } catch (error) {
      const applied = writeFailure(error, stored);
      if (applied === undefined) throw error;
      return applied;
    }
  };

  /** A create's id, taken before the write; an update's resulting version, from the writer's dry run (null when it would be refused). */
  const intentOf = async (stored: StoredItemProposal, fields: Record<string, unknown>) => {
    if (stored.kind === "create") return { intent: { itemId: randomUUIDv7() } satisfies ItemIntent };
    const item = itemById((await catalog.snapshot()).items, stored.itemId);
    const itemHandle = item?.handle ?? null;
    if (stored.kind === "delete") return { intent: { itemId: stored.itemId, path: item?.path ?? null } satisfies ItemIntent, itemHandle };
    let version: string | null = null;
    try {
      if (itemHandle !== null) version = (await writer.check({ kind: "update", handle: itemHandle, fields, baseVersion: stored.baseVersion ?? "" })) ?? null;
    } catch {
      // The write runs the same checks and settles their refusal.
    }
    return { intent: { itemId: stored.itemId, version } satisfies ItemIntent, itemHandle };
  };

  return {
    checkItemProposal: (agentId, change, reason) => {
      if (change.kind === "create") return checkCreate(agentId, change.structure, change.input, reason);
      if (change.kind === "update") return checkUpdate(agentId, change.handle, change.fields, change.version, reason);
      return checkDelete(agentId, change.handle, change.version, reason);
    },

    itemProposalsOf: async (stored) => {
      if (stored.length === 0) return [];
      const { items } = await catalog.snapshot();
      return stored.map((proposal) => proposalOf(proposal, items));
    },

    itemProposalDetail: async (stored, n) => {
      const { structures, items } = await catalog.snapshot();
      const chosen = store.listVersions(stored.id).find((version) => version.n === n)?.content;
      if (chosen === undefined) throw new Error(`Proposal ${stored.id} has no version ${String(n)} stored; it can't be read.`);
      const item = itemById(items, stored.itemId);
      return {
        ...proposalOf(stored, items),
        fields: fieldsOf(stored.id, chosen),
        current: item === undefined ? null : withLinks(item, structures, handlesById(items)),
        versions: store.listVersionHeads(stored.id),
      };
    },

    itemTarget: {
      intentOf: (stored, content) => intentOf(itemOnly(stored), fieldsOf(stored.id, content)),
      write: (stored, content) => write(itemOnly(stored), fieldsOf(stored.id, content)),
      written: async (stored) => {
        const item = itemOnly(stored);
        const { structures, items } = await catalog.snapshot();
        const { path } = (item.intent ?? {}) as ItemIntent;
        return itemWritten(item, { items, structureRead: structureRead(structures, item.structure), fileMissing: item.kind === "delete" && path != null && (await missing(join(catalog.root, path))) });
      },
    },
  };
};
