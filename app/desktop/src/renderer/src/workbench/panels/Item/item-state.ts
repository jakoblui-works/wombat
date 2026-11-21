// What an item tab shows, from the read by id, the binders and the binder's list, pure. Each state claims only what
// its evidence shows: when two explanations fit, the tab says both.
import { ItemsErrorCode } from "@wombat/shared/api";
import { type BinderSummary, type Item, type ItemSummary, SETTINGS_FILE } from "@wombat/shared/items";
import { ServiceError } from "../../../data/client.ts";
import { asError } from "../../../lib/errors.ts";
import { NO_FILE } from "./item-edit.ts";

export type Binder = Extract<BinderSummary, { id: string }>;
export type BrokenBinder = Extract<BinderSummary, { id: null }>;

export type ItemShown =
  | { kind: "loading" }
  | { kind: "item"; item: Item; binder: Binder }
  /** The read by id can't find it, and its last path is listed without an id: the file can't be parsed. */
  | { kind: "unparseable"; entry: ItemSummary; last: Item; binder: Binder }
  /** The read by id can't find it, and the binder has files that can't be parsed (or there is no last path to check). */
  | { kind: "missing"; unreadable: ItemSummary[]; last: Item | undefined; binder: Binder }
  /** The read by id can't find it, its last path isn't listed, and every file in the binder can be parsed. */
  | { kind: "gone"; last: Item; binder: Binder }
  /** The binder isn't listed by id, and a broken binder's folder holds the item's last path. */
  | { kind: "binder-broken"; binder: BrokenBinder; last: Item }
  /** The binder isn't listed by id, and some binders are broken: one of them may be it. */
  | { kind: "binder-missing"; broken: BrokenBinder[]; last: Item | undefined }
  /** The binder isn't listed by id, and no binder is broken. */
  | { kind: "binder-gone"; last: Item | undefined }
  | { kind: "error"; what: "item" | "binders" | "binder-items"; message: string; last: Item | undefined };

/** A query as TanStack gives it: `data` may be stale beside an `error`. */
export type Read<T> = { data: T | undefined; error: unknown };

type Reads = {
  item: Read<Item>;
  binders: Read<readonly BinderSummary[]>;
  /** The tab's binder's items. */
  listed: Read<readonly ItemSummary[]>;
};

/** Whether the service answered that no item has the ref read. */
export const isItemNotFound = (error: unknown): boolean => error instanceof ServiceError && error.code === ItemsErrorCode.enum.item_not_found;

/** Whether the service answered the read with an error (a read the bridge refused, while disconnected, didn't reach it). */
const answeredWithError = (read: Read<unknown>): boolean => read.error instanceof ServiceError;

/**
 * A query's data as the service last gave it: kept through a read the bridge refused (the panel dims meanwhile),
 * dropped once the service answered with an error.
 */
export const usable = <T>(read: Read<T>): T | undefined => (answeredWithError(read) ? undefined : read.data);

/** The read's error when it leaves no data to show; undefined while it's loading or has data. */
export const unshown = (read: Read<unknown>): string | undefined =>
  usable(read) === undefined && read.error !== null && read.error !== undefined ? asError(read.error).message : undefined;

/** A broken binder's settings file, relative to the items root. */
export const settingsPath = ({ path }: BrokenBinder): string => (path === "" || path === "." ? SETTINGS_FILE : `${path}/${SETTINGS_FILE}`);

const inFolder = (path: string, folder: string): boolean => folder === "" || folder === "." || path.startsWith(`${folder}/`);

/** The binder whose folder holds `path`, the deepest one when they nest. */
const binderHolding = <B extends BinderSummary>(binders: readonly B[], path: string): B | undefined =>
  binders.filter((binder) => inFolder(path, binder.path)).sort((a, b) => b.path.length - a.path.length)[0];

const isBroken = (binder: BinderSummary): binder is BrokenBinder => binder.id === null;

/** The binder an item tab shows: the item's binder as read (a file moved by hand into another binder names that one), else the tab's binder. */
const shownBinder = (binderId: string, binders: readonly BinderSummary[], item: Item | undefined): Binder | undefined => {
  const id = item?.binder ?? binderId;
  return binders.find((each): each is Binder => each.id === id);
};

/** Why a binder isn't listed by id: some binders are broken (one of them may be it), or none is. */
export type NoBinder = { kind: "binder-missing"; broken: BrokenBinder[] } | { kind: "binder-gone" };

const withoutBinder = (binders: readonly BinderSummary[]): NoBinder => {
  const broken = binders.filter(isBroken);
  return broken.length > 0 ? { kind: "binder-missing", broken } : { kind: "binder-gone" };
};

/** The binder listed with `binderId`, else why it isn't (`NoBinder`). */
export const binderOf = (binderId: string, binders: readonly BinderSummary[]): { kind: "binder"; binder: Binder } | NoBinder => {
  const binder = binders.find((each): each is Binder => each.id === binderId);
  return binder === undefined ? withoutBinder(binders) : { kind: "binder", binder };
};

/**
 * The binders decide first, then the read by id, then the binder's list. An item the service reads is shown in the
 * binder `shownBinder` picks.
 */
export const itemShown = (itemId: string, binderId: string, { item, binders, listed }: Reads): ItemShown => {
  const shownItem = usable(item);
  const last = item.data;

  const binderList = usable(binders);
  if (binderList === undefined) {
    const failed = unshown(binders);
    return failed === undefined ? { kind: "loading" } : { kind: "error", what: "binders", message: failed, last };
  }
  const binder = shownBinder(binderId, binderList, shownItem);
  if (binder === undefined) {
    const holding = last === undefined ? undefined : binderHolding(binderList.filter(isBroken), last.path);
    if (holding !== undefined && last !== undefined) return { kind: "binder-broken", binder: holding, last };
    return { ...withoutBinder(binderList), last };
  }

  if (shownItem !== undefined) return { kind: "item", item: shownItem, binder };
  if (!(item.error instanceof ServiceError)) {
    const failed = unshown(item);
    return failed === undefined ? { kind: "loading" } : { kind: "error", what: "item", message: failed, last };
  }
  if (!isItemNotFound(item.error)) return { kind: "error", what: "item", message: item.error.message, last };

  const entries = usable(listed);
  if (entries === undefined) {
    const failed = unshown(listed);
    if (failed !== undefined) return { kind: "error", what: "binder-items", message: failed, last };
    // The list is on its way (an alert reads it again beside the item): the last item shows until it arrives.
    return last === undefined ? { kind: "loading" } : { kind: "item", item: last, binder };
  }
  const unreadable = entries.filter(({ id }) => id === null);
  const entry = last === undefined ? undefined : entries.find(({ path }) => path === last.path);
  if (last !== undefined && entry?.id === null) return { kind: "unparseable", entry, last, binder };
  if (last !== undefined && entry?.id === itemId) return { kind: "item", item: last, binder };
  if (last === undefined || unreadable.length > 0) return { kind: "missing", unreadable, last, binder };
  return { kind: "gone", last, binder };
};

/** The listed binder the tab shows the item in, for its header and fields; undefined when it shows none. */
export const listedBinder = (shown: ItemShown): Binder | undefined => ("binder" in shown && shown.binder.id !== null ? shown.binder : undefined);

/** The item as last read, for the tab's title and header; undefined before any read succeeded. */
export const lastKnown = (shown: ItemShown): Item | undefined => {
  switch (shown.kind) {
    case "item":
      return shown.item;
    case "loading":
      return undefined;
    default:
      return shown.last;
  }
};

/**
 * What a draft's tab shows, from the binders: the draft (an item with no file yet) while its binder is listed, else
 * why not. Without an item there is no path, so a broken binder is never claimed as the draft's own.
 */
export const draftShown = (binderId: string, binders: Read<readonly BinderSummary[]>): ItemShown => {
  const binderList = usable(binders);
  if (binderList === undefined) {
    const failed = unshown(binders);
    return failed === undefined ? { kind: "loading" } : { kind: "error", what: "binders", message: failed, last: undefined };
  }
  const found = binderOf(binderId, binderList);
  return found.kind === "binder" ? { kind: "item", item: NO_FILE, binder: found.binder } : { ...found, last: undefined };
};

/** What an item tab's form edits: the item as last read (a draft's `NO_FILE`) in the binder last listed. */
export type ItemForm = { item: Item; binder: Binder | undefined; savable: boolean };

/**
 * The form an item tab keeps for as long as it is open, from its first read on: the item as last read (a draft's
 * `NO_FILE`), the binder shown now else the one last listed (`lastBinder`), and `savable` only while the tab shows the
 * item now. Undefined before there is an item to edit, and for a draft before its binder was listed (its start values
 * and naming come from the binder).
 */
export const itemForm = (shown: ItemShown, lastBinder: Binder | undefined, draft: boolean): ItemForm | undefined => {
  const binder = listedBinder(shown) ?? lastBinder;
  const item = draft ? (binder === undefined ? undefined : NO_FILE) : lastKnown(shown);
  return item === undefined ? undefined : { item, binder, savable: shown.kind === "item" };
};
