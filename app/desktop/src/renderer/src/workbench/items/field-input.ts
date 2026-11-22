// What the item tab's controls accept and show, pure.
import type { ItemSummary, LenientProperty, LinkValue } from "@wombat/shared/items";

import { linkValue, MISSING_ITEM, numberOfText } from "./values.ts";

/** A field as the form edits it: title, body or a property's value (a link as its target's id); null clears a property. */
export type FieldValue = string | number | null;

/** A property's value as the form edits it: a link as its target's id, any other non-field value as its JSON text. */
export const fieldValue = (value: unknown): FieldValue => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return linkValue(value)?.id ?? JSON.stringify(value);
};

/** The value an emptied text, date or number input sends. */
export const inputValue = (text: string): FieldValue => (text === "" ? null : text);

/** A number input's text as typed, and its value (`numberOfText`): null when empty, undefined while it isn't a number. */
export const numberDraft = (raw: string): { text: string; value: number | null | undefined } => ({ text: raw, value: numberOfText(raw) });

/** What a number input shows: my draft while it is the value or on its way to one, else the value. */
export const shownNumber = (draft: string, value: FieldValue): string => {
  const parsed = numberDraft(draft).value;
  return parsed === undefined || parsed === value ? draft : value === null ? "" : String(value);
};

export type LinkOption = { id: string; handle: string | null; title: string | null };

/** The items a link may point at: its target binder's items that have an id, in the binder's order. */
export const linkOptions = (items: readonly ItemSummary[] | undefined): LinkOption[] =>
  (items ?? []).flatMap(({ id, handle, title }) => (id === null ? [] : [{ id, handle, title }]));

/**
 * The item a link value points at: from its target binder's list, else, until the list holds it (loading, failed),
 * from the link as the item's file was read (`fileLink`, `linkValue` of it) when that names the same id and found it.
 */
export const linkTarget = (value: FieldValue, items: readonly ItemSummary[] | undefined, fileLink: LinkValue | undefined): LinkOption | undefined =>
  linkOptions(items).find(({ id }) => id === value) ??
  (fileLink !== undefined && fileLink.id === value && fileLink.handle !== null ? { id: fileLink.id, handle: fileLink.handle, title: null } : undefined);

/** A field's value as text beside another (the conflict): "none" when empty, a link as its target's handle and title. */
export const valueText = (property: LenientProperty | undefined, value: FieldValue, target: LinkOption | undefined): string => {
  if (value === null || value === "") return "none";
  if (property?.type !== "link") return String(value);
  return target === undefined ? MISSING_ITEM : [target.handle, target.title].filter((part) => part !== null).join(" ");
};

/**
 * Whether a select's value change is the user's pick. Base UI also changes the value itself (reason "none") when the
 * value isn't among the items, such as a link target deleted meanwhile: that would replace my value without my asking.
 */
export const pickedByUser = (reason: string): boolean => reason === "item-press";
