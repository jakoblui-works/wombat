// The item side of proposals: the checks a proposed item change runs before anything is stored (the direct change's,
// in its order), the item target an approve writes through, and item proposals as people read them. Approving
// applies a proposal through the writer on the version the agent read, under the binder's settings as they are
// now; anything changed since makes it a conflict, never an overwrite.
import { randomUUIDv7 } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { ItemWriteErrorCode } from "@wombat/shared/api";
import { isMissing } from "@wombat/shared/errno";
import type { Item } from "@wombat/shared/items";
import type { ItemProposal, ProposalVersion } from "@wombat/shared/proposals";

import { agentWriteError, itemFor, binderFor, viewOf, type View } from "../items/agent-view.ts";
import { handlesById, withLinks } from "../items/api-view.ts";
import type { Catalog, LoadedItem, LoadedBinder, ValidBinder } from "../items/catalog.ts";
import { writeGuards, type WriteGuards } from "../items/guards.ts";
import { lockedNames, newItem, type Change, type ItemInput } from "../items/refusals.ts";
import { SETTINGS_FILE } from "../items/binders.ts";
import { ItemWriteError, presentValues, type Writer } from "../items/write.ts";
import type { VersionAuthor } from "../store/proposal-rules.ts";
import { fieldsOf } from "../store/proposals.ts";
import type { NewProposal, ProposalVersionHead, Store, StoredProposal } from "../store/store.ts";
import { askAgain, BY_HAND, conflict, failureOutcome, NOTHING_WRITTEN, type Applied, type ApplyTarget, type Written } from "./apply.ts";
import { itemRevisions, type ItemRevisions } from "./item-revisions.ts";
import { createFields, createInputOf, itemById, targetItem, type StoredItemProposal } from "./item-target.ts";
import { commonFields } from "./proposal-fields.ts";

export type ProposalResult = { proposed: string };

/** An item proposal as sent, with its base version, for the service's own callers; no version's content. */
export type ItemProposalRecord = ItemProposal & { baseVersion: string | null };

/** `fields`: what the version read proposes. */
export type ItemProposalDetail = ItemProposalRecord & { fields: Record<string, unknown>; current: Item | null; versions: ProposalVersion[] };

export type { StoredItemProposal };

/** A proposed item change as the item tools take it. */
export type ProposedItemChange =
  | { kind: "create"; binder: string; input: ItemInput }
  | { kind: "update"; handle: string; fields: Record<string, unknown>; version: string }
  | { kind: "delete"; handle: string; version: string };

/** An item proposal that passed its checks: what to store, and its first version's fields. */
type CheckedItemProposal = { proposal: Extract<NewProposal, { target: "item" }>; fields: Record<string, unknown> };

export type ItemProposals = ItemRevisions & {
  /** Runs `change`'s checks as `agentId` proposes it; throws the agent's refusal. Stores nothing. */
  checkItemProposal(agentId: string, change: ProposedItemChange, reason: string): Promise<CheckedItemProposal>;
  /** For people (HTTP): the stored item proposals as sent, each with its item's handle now, or the one it had. */
  itemProposalsOf(stored: readonly StoredItemProposal[]): Promise<ItemProposalRecord[]>;
  /** As `itemProposalsOf`, with its item as it is now (null when gone), the version read's `fields` and every version's head. */
  itemProposalDetail(stored: StoredItemProposal, fields: Record<string, unknown>, heads: readonly ProposalVersionHead[]): Promise<ItemProposalDetail>;
  /**
   * For the agent: each stored item proposal's handle when its item is one the agent may see now; a gone item's the
   * handle it had, while its binder is visible. Proposals left out have no handle the agent may be told.
   */
  agentHandlesOf(stored: readonly StoredItemProposal[]): Promise<Map<string, string>>;
  /** What an approve writes an item proposal through. */
  itemTarget: ApplyTarget;
};

export type ItemProposalsOptions = { catalog: Catalog; writer: Writer; store: Store };

/**
 * What an item approve's applying commit stores: a create's new id; an update's resulting file version; a delete's
 * item file (relative to the root; null when the item wasn't there to delete).
 */
type ItemIntent = { itemId?: string | null; version?: string | null; path?: string | null };

/** What a written check reads of the items now: the items, whether the proposal's binder was read whole, whether a delete's file is missing on disk. */
type ItemsNow = { items: readonly LoadedItem[]; binderRead: boolean; fileMissing: boolean };

/** Whether a binder was read whole: it has settings, and no folder of it failed to read (its only problems without a field). */
export const binderRead = (binders: readonly LoadedBinder[], id: string) =>
  binders.some((binder) => binder.id === id && binder.problems.every((problem) => problem.field !== undefined));

const itemOnly = (stored: StoredProposal): StoredItemProposal => {
  if (stored.target !== "item") throw new Error(`Proposal ${stored.id} isn't an item proposal; it can't be handled as one.`);
  return stored;
};

/** The fields of a version by `by` that are locked in `binder` now: the agent's locks never bind my version. */
const bindingLocks = (binder: ValidBinder, kind: Change, names: string[], by: VersionAuthor) => (by === "me" ? [] : lockedNames(binder, kind, names));

/** A stored item proposal as sent: its item's handle among `items` now, else the one the applying commit stored. */
export const itemProposalOf = (stored: StoredItemProposal, heads: readonly ProposalVersionHead[], items: readonly LoadedItem[] = []): ItemProposalRecord => ({
  ...commonFields(stored, heads),
  target: "item",
  binder: stored.binder,
  kind: stored.kind,
  handle: itemById(items, stored.itemId)?.handle ?? stored.itemHandle ?? null,
  file: stored.file,
  baseVersion: stored.baseVersion,
});

/**
 * Whether the write `intent` describes is what the items hold now: the created item exists, the update's version is
 * there, the deleted item's file is gone and no item has its id. Throws when the binder wasn't read whole: an item
 * missing from it may still be there or have been made, and settling it pending would let a second approve write again.
 */
export const itemWritten = (stored: StoredItemProposal, now: ItemsNow): Written | undefined => {
  const intent = (stored.intent ?? {}) as ItemIntent;
  if (!now.binderRead) throw new Error(`Proposal ${stored.id}'s binder can't be read whole, so whether its ${stored.kind} was written can't be told.`);
  if (stored.kind === "create") {
    const made = itemById(now.items, intent.itemId);
    return made?.id == null ? undefined : { written: true, itemId: made.id, ...(made.handle === null ? {} : { itemHandle: made.handle }) };
  }
  if (stored.kind === "delete") return intent.path != null && now.fileMissing && itemById(now.items, stored.itemId) === undefined ? { written: true } : undefined;
  const item = itemById(now.items, stored.itemId);
  return item !== undefined && intent.version != null && item.version === intent.version ? { written: true } : undefined;
};

/** The handle the agent may be told for an item proposal, by `view`: never one of an item or binder hidden from it. */
const agentHandle = (view: View, stored: StoredItemProposal): string | undefined => {
  const visible = itemById(view.items, stored.itemId);
  if (visible !== undefined) return visible.handle ?? undefined;
  const exists = itemById(view.snapshot.items, stored.itemId) !== undefined;
  return !exists && view.binders.has(stored.binder) ? stored.itemHandle : undefined;
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

const ASK_AGAIN = askAgain("item");

const ITEM_GONE = conflict(`The item was deleted, or its id changed by hand, since the agent read it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);

const ITEM_CHANGED = conflict(`The item changed (edited, renamed or deleted) since the agent read it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);

/** What a failed item write settles to: a conflict for what changed, a retry for a target the user can fix; undefined for the unexpected. */
const writeFailure = (error: unknown, stored: StoredItemProposal): Applied | undefined => {
  if (!(error instanceof ItemWriteError)) return failureOutcome(error, stored.kind === "create" ? "create" : "edit", "write");
  if (error.code === ItemWriteErrorCode.enum.stale_version || error.code === ItemWriteErrorCode.enum.item_not_found) return ITEM_CHANGED;
  if (error.code === ItemWriteErrorCode.enum.items_not_writable) {
    return conflict(`${error.message} Nothing was written: keep the items root on a local filesystem and ask the agent to propose again, or reject the proposal.`);
  }
  const [only] = error.problems;
  return conflict(error.message, error.problems.length === 1 ? only?.field : undefined);
};

/**
 * The checks an agent's new or changed item runs before anything is stored, for its proposal and its revision alike:
 * the guards, then the writer's dry run. Each throws the agent's refusal and answers the fields to store (links as ids).
 */
const itemChecks = (writer: Writer, guards: WriteGuards) => ({
  checkedCreate: async (current: View, binder: ValidBinder, input: ItemInput): Promise<Record<string, unknown>> => {
    const linked = presentValues(await guards.create(current, binder, input, "propose"));
    try {
      await writer.check({ kind: "create", binderId: binder.id, item: newItem(input, linked), unseen: current.hiddenFolders });
    } catch (error) {
      throw agentWriteError(current, error, { binder });
    }
    return createFields(input, linked);
  },

  /** `handle`, the item's; `named`, the handle the agent gave, which a refusal names. */
  checkedUpdate: async (current: View, binder: ValidBinder, handle: string, fields: Record<string, unknown>, baseVersion: string, named = handle): Promise<Record<string, unknown>> => {
    const linked = guards.update(current, binder, fields, "propose");
    try {
      await writer.check({ kind: "update", handle, fields: linked, baseVersion });
    } catch (error) {
      throw agentWriteError(current, error, { handle: named, binder });
    }
    return linked;
  },
});

export type ItemChecks = ReturnType<typeof itemChecks>;

export const openItemProposals = ({ catalog, writer, store }: ItemProposalsOptions): ItemProposals => {
  const view = async () => viewOf(await catalog.snapshot());
  const guards = writeGuards(writer);
  const checks = itemChecks(writer, guards);

  const checkCreate = async (agentId: string, binderId: string, input: ItemInput, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const binder = binderFor(current, binderId);
    return {
      proposal: { target: "item", path: null, binder: binder.id, itemId: null, kind: "create", file: input.file ?? null, reason, baseVersion: null, agentId },
      fields: await checks.checkedCreate(current, binder, input),
    };
  };

  const checkUpdate = async (agentId: string, handle: string, fields: Record<string, unknown>, version: string, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const { item, binder, handle: target } = itemFor(current, handle);
    return {
      proposal: { target: "item", path: null, binder: binder.id, itemId: item.id, kind: "update", file: null, reason, baseVersion: version, agentId },
      fields: await checks.checkedUpdate(current, binder, target, fields, version, handle),
    };
  };

  const checkDelete = async (agentId: string, handle: string, version: string, reason: string): Promise<CheckedItemProposal> => {
    const current = await view();
    const { item, binder, handle: target } = itemFor(current, handle);
    guards.remove(current, binder, item, target, "propose");
    try {
      await writer.check({ kind: "delete", handle: target, baseVersion: version });
    } catch (error) {
      throw agentWriteError(current, error, { handle, binder });
    }
    return {
      proposal: { target: "item", path: null, binder: binder.id, itemId: item.id, kind: "delete", file: null, reason, baseVersion: version, agentId },
      fields: {},
    };
  };

  /** Applies a proposal, or says why it can't be: what changed since the agent read the item. */
  const write = async (stored: StoredItemProposal, fields: Record<string, unknown>, by: VersionAuthor): Promise<Applied> => {
    const snapshot = await catalog.snapshot();
    const current = viewOf(snapshot);
    const binder = current.binders.get(stored.binder);
    const access = current.hiddenBinders.has(stored.binder) ? "hidden" : binder?.settings.access;
    if (access === "hidden" || access === "read") {
      return conflict(`${stored.binder} is now ${access}: agents' changes no longer apply to it, ${NOTHING_WRITTEN}. ${BY_HAND}`, "access");
    }
    if (binder === undefined) {
      return conflict(`The binder ${stored.binder} is gone, or its ${SETTINGS_FILE} is broken, ${NOTHING_WRITTEN}. Fix its settings and ask the agent again, or reject the proposal.`);
    }
    const locked = bindingLocks(binder, stored.kind, Object.keys(fields), by);
    if (locked.length > 0) {
      return conflict(`${locked.join(", ")} became locked in ${stored.binder}, ${NOTHING_WRITTEN}. ${BY_HAND}`, locked[0]);
    }

    try {
      if (stored.kind === "create") {
        const { written } = createInputOf(fields, stored.file);
        const { itemId } = (stored.intent ?? {}) as ItemIntent;
        const created = await writer.createItem(binder.id, newItem(written, written.properties), itemId ?? undefined);
        return created.id === null ? { written: true } : { written: true, itemId: created.id, ...(created.handle === null ? {} : { itemHandle: created.handle }) };
      }
      const target = targetItem(snapshot.items, stored);
      if (target === "gone" || (stored.kind === "delete" && ((stored.intent ?? {}) as ItemIntent).path == null)) return ITEM_GONE;
      if ("movedTo" in target) return conflict(`The item moved to ${target.movedTo} since the agent read it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);
      const baseVersion = stored.baseVersion ?? "";
      if (stored.kind === "update") await writer.updateItem(target.handle, fields, baseVersion);
      else await writer.deleteItem(target.handle, baseVersion);
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
    ...itemRevisions({ catalog, writer, checks }),

    checkItemProposal: (agentId, change, reason) => {
      if (change.kind === "create") return checkCreate(agentId, change.binder, change.input, reason);
      if (change.kind === "update") return checkUpdate(agentId, change.handle, change.fields, change.version, reason);
      return checkDelete(agentId, change.handle, change.version, reason);
    },

    itemProposalsOf: async (stored) => {
      if (stored.length === 0) return [];
      const { items } = await catalog.snapshot();
      return stored.map((proposal) => itemProposalOf(proposal, store.listVersionHeads(proposal.id), items));
    },

    agentHandlesOf: async (stored) => {
      const handles = new Map<string, string>();
      if (stored.length === 0) return handles;
      const current = await view();
      for (const proposal of stored) {
        const handle = agentHandle(current, proposal);
        if (handle !== undefined) handles.set(proposal.id, handle);
      }
      return handles;
    },

    itemProposalDetail: async (stored, fields, heads) => {
      const { binders, items } = await catalog.snapshot();
      const item = itemById(items, stored.itemId);
      return {
        ...itemProposalOf(stored, heads, items),
        fields,
        current: item === undefined ? null : withLinks(item, binders, handlesById(items)),
        versions: [...heads],
      };
    },

    itemTarget: {
      intentOf: (stored, content) => intentOf(itemOnly(stored), fieldsOf(content)),
      write: (stored, content, by) => write(itemOnly(stored), fieldsOf(content), by),
      written: async (stored) => {
        const item = itemOnly(stored);
        const { binders, items } = await catalog.snapshot();
        const { path } = (item.intent ?? {}) as ItemIntent;
        return itemWritten(item, { items, binderRead: binderRead(binders, item.binder), fileMissing: item.kind === "delete" && path != null && (await missing(join(catalog.root, path))) });
      },
    },
  };
};
