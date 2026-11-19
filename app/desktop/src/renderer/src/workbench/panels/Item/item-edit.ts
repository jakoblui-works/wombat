// What an item tab holds while I edit it, pure: the item my changes are on, the file as last read, my changes, a save
// under way, a refused save's problems and a conflict after a stale save.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Item, Problem } from "@wombat/shared/items";

import { ServiceError } from "../../../data/client.ts";
import { asError } from "../../../lib/errors.ts";
import { linkValue } from "../Desk/view-model/values.ts";

/** A field as the form edits it: title, body or a property's value (a link as its target's id); null clears a property. */
export type FieldValue = string | number | null;

export type ItemEditEvent =
  | { type: "edit"; field: string; value: FieldValue }
  | { type: "refreshed"; item: Item }
  | { type: "saving" }
  | { type: "saved"; item: Item }
  | { type: "refused"; problems: Problem[] }
  /** A save answered stale_version, with the item as read after it. */
  | { type: "stale"; item: Item }
  | { type: "keepMine" }
  | { type: "takeTheirs"; field: string }
  | { type: "discard" };

export type ItemEditState = {
  /** The item my changes are on; a save names its version. */
  readonly base: Item;
  /** The file as last read. */
  readonly latest: Item;
  /** My changes, each different from the file as last read. */
  readonly mine: Readonly<Record<string, FieldValue>>;
  /** The fields the save under way sent, as sent. */
  readonly sent: Readonly<Record<string, FieldValue>>;
  readonly conflict: boolean;
  readonly saving: boolean;
  readonly problems: readonly Problem[];
};

/** The file's value of `field` in `item`; a value of no field type (an invalid item's) as its JSON text. */
export const fileValue = (item: Item, field: string): FieldValue => {
  if (field === "title") return item.title;
  if (field === "body") return item.body;
  const value = Object.hasOwn(item.properties, field) ? item.properties[field] : undefined;
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return linkValue(value)?.id ?? JSON.stringify(value);
};

/**
 * Drops my changes the file as last read already holds (a change back to the base while the file moved on stays one);
 * with none left, the base is the file and the conflict is over.
 */
const settled = (state: ItemEditState): ItemEditState => {
  const mine = Object.fromEntries(Object.entries(state.mine).filter(([field, value]) => value !== fileValue(state.latest, field)));
  return Object.keys(mine).length === 0 ? { ...state, mine, base: state.latest, conflict: false } : { ...state, mine };
};

export const initialEdit = (item: Item): ItemEditState => ({ base: item, latest: item, mine: {}, sent: {}, conflict: false, saving: false, problems: [] });

/**
 * My changes once a save of `sent` is written: a sent field is cleared unless I changed it again meanwhile. Not by
 * comparing with the written item, which the service normalises (it trims the title).
 */
const unsent = (mine: Readonly<Record<string, FieldValue>>, sent: Readonly<Record<string, FieldValue>>): Record<string, FieldValue> =>
  Object.fromEntries(Object.entries(mine).filter(([field, value]) => !Object.hasOwn(sent, field) || sent[field] !== value));

const without = (mine: Readonly<Record<string, FieldValue>>, field: string): Record<string, FieldValue> =>
  Object.fromEntries(Object.entries(mine).filter(([name]) => name !== field));

export const itemEdit = (state: ItemEditState, event: ItemEditEvent): ItemEditState => {
  switch (event.type) {
    case "edit":
      return settled({ ...state, mine: { ...state.mine, [event.field]: event.value } });
    case "refreshed":
      return settled({ ...state, latest: event.item });
    case "saving":
      return { ...state, saving: true, problems: [], sent: { ...state.mine } };
    case "saved":
      return settled({ ...state, mine: unsent(state.mine, state.sent), sent: {}, saving: false, base: event.item, latest: event.item, conflict: false });
    case "refused":
      return { ...state, saving: false, problems: event.problems };
    case "stale":
      return settled({ ...state, saving: false, latest: event.item, conflict: Object.keys(state.mine).length > 0 });
    case "keepMine":
      return settled({ ...state, base: state.latest, conflict: false });
    case "takeTheirs":
      return settled({ ...state, mine: without(state.mine, event.field) });
    case "discard":
      return settled({ ...state, mine: {}, problems: [], conflict: false });
  }
};

/** What a save sends: my changes. */
export const changedFields = (state: ItemEditState): Record<string, FieldValue> => ({ ...state.mine });

/** The PATCH body: my changes on the version they're based on. */
export const saveRequest = (state: ItemEditState): { version: string; fields: Record<string, FieldValue> } => ({ version: state.base.version, fields: changedFields(state) });

/** What the form shows for `field`: my value when I changed it, else the file's as last read. */
export const valueOf = (state: ItemEditState, field: string): FieldValue => (Object.hasOwn(state.mine, field) ? (state.mine[field] ?? null) : fileValue(state.latest, field));

/** The file changed under my unsaved changes. */
export const fileChanged = (state: ItemEditState): boolean => state.latest.version !== state.base.version;

/** After a stale save, each changed field: mine against the file's now. */
export const conflicts = (state: ItemEditState): { field: string; mine: FieldValue; theirs: FieldValue }[] =>
  state.conflict ? Object.entries(state.mine).map(([field, mine]) => ({ field, mine, theirs: fileValue(state.latest, field) })) : [];

export const saveProblems = (state: ItemEditState): Problem[] => [...state.problems];

export const isSaving = (state: ItemEditState): boolean => state.saving;

/** Save is offered with changes, none under way and no conflict open (Keep mine saves then). */
export const canSave = (state: ItemEditState): boolean => Object.keys(state.mine).length > 0 && !state.saving && !state.conflict;

/** What a failed save comes to: "stale" (read the item again for the conflict), else the problems to show. */
export const saveFailure = (error: unknown): "stale" | Problem[] => {
  if (error instanceof ServiceError && error.code === ItemWriteErrorCode.enum.stale_version) return "stale";
  if (error instanceof ServiceError && error.problems !== undefined && error.problems.length > 0) return [...error.problems];
  return [{ message: asError(error).message }];
};
