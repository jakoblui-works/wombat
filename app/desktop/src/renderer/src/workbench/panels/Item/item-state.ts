// What an item tab shows, from the read by id, the binders and the binder's list, pure. Each state claims only what
// its evidence shows: when two explanations fit, the tab says both.
import { ItemsErrorCode } from "@wombat/shared/api";
import { type BinderSummary, type Item, type ItemSummary, SETTINGS_FILE } from "@wombat/shared/items";
import { ServiceError } from "../../../data/client.ts";
import { asError } from "../../../lib/errors.ts";

type Binder = Extract<BinderSummary, { id: string }>;
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
type Read<T> = { data: T | undefined; error: unknown };

type Reads = {
  item: Read<Item>;
  binders: Read<readonly BinderSummary[]>;
  /** The tab's binder's items. */
  listed: Read<readonly ItemSummary[]>;
};

/** Whether the service answered the read with an error (a read the bridge refused, while disconnected, didn't reach it). */
const answeredWithError = (read: Read<unknown>): boolean => read.error instanceof ServiceError;

/**
 * A query's data as the service last gave it: kept through a read the bridge refused (the panel dims meanwhile),
 * dropped once the service answered with an error.
 */
export const usable = <T>(read: Read<T>): T | undefined => (answeredWithError(read) ? undefined : read.data);

/** The read's error when it leaves no data to show; undefined while it's loading or has data. */
const unshown = (read: Read<unknown>): string | undefined =>
  usable(read) === undefined && read.error !== null && read.error !== undefined ? asError(read.error).message : undefined;

/** A broken binder's settings file, relative to the items root. */
export const settingsPath = ({ path }: BrokenBinder): string => (path === "" || path === "." ? SETTINGS_FILE : `${path}/${SETTINGS_FILE}`);

const inFolder = (path: string, folder: string): boolean => folder === "" || folder === "." || path.startsWith(`${folder}/`);

/** The binder whose folder holds `path`, the deepest one when they nest. */
const binderHolding = <B extends BinderSummary>(binders: readonly B[], path: string): B | undefined =>
  binders.filter((binder) => inFolder(path, binder.path)).sort((a, b) => b.path.length - a.path.length)[0];

const isBroken = (binder: BinderSummary): binder is BrokenBinder => binder.id === null;
const isListed = (binder: BinderSummary): binder is Binder => binder.id !== null;

/**
 * The binders decide first, then the read by id, then the binder's list. An item the service reads is shown in the
 * binder that lists it by id, else in the binder whose folder holds its file.
 */
export const itemShown = (itemId: string, binderId: string, { item, binders, listed }: Reads): ItemShown => {
  const shownItem = usable(item);
  const last = item.data;

  const binderList = usable(binders);
  if (binderList === undefined) {
    const failed = unshown(binders);
    return failed === undefined ? { kind: "loading" } : { kind: "error", what: "binders", message: failed, last };
  }
  const binder = binderList.find((each): each is Binder => each.id === binderId) ?? (shownItem === undefined ? undefined : binderHolding(binderList.filter(isListed), shownItem.path));
  if (binder === undefined) {
    const broken = binderList.filter(isBroken);
    const holding = last === undefined ? undefined : binderHolding(broken, last.path);
    if (holding !== undefined && last !== undefined) return { kind: "binder-broken", binder: holding, last };
    return broken.length > 0 ? { kind: "binder-missing", broken, last } : { kind: "binder-gone", last };
  }

  if (shownItem !== undefined) return { kind: "item", item: shownItem, binder };
  if (!(item.error instanceof ServiceError)) {
    const failed = unshown(item);
    return failed === undefined ? { kind: "loading" } : { kind: "error", what: "item", message: failed, last };
  }
  if (item.error.code !== ItemsErrorCode.enum.item_not_found) return { kind: "error", what: "item", message: item.error.message, last };

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
