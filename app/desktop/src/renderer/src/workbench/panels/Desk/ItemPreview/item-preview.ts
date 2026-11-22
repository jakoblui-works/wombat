// What the preview box shows and which row it's on, pure.
import { type BinderSummary, isItemId, type Item, type ItemSummary } from "@wombat/shared/items";

import { asError } from "../../../../lib/errors.ts";
import { isItemNotFound } from "../../Item/item-state.ts";
import { displayValue } from "../../../items/values.ts";
import { isItemRow, type Row } from "../view-model/view-model.ts";

export type PreviewShown =
  | { kind: "loading" }
  | { kind: "item"; item: Item }
  | { kind: "not-found" }
  /** The file is listed without an id: it can't be parsed. */
  | { kind: "unparseable"; item: ItemSummary }
  | { kind: "error"; message: string };

/**
 * What the preview shows from the read and the item as its binder lists it, when known: a listing without an id is a
 * file that can't be parsed (the read can't find it by any ref), else the read decides.
 */
export const previewShown = ({ data, error }: { data: Item | undefined; error: unknown }, listed?: ItemSummary): PreviewShown => {
  if (listed?.id === null) return { kind: "unparseable", item: listed };
  if (isItemNotFound(error)) return { kind: "not-found" };
  if (data !== undefined) return { kind: "item", item: data };
  if (error !== null && error !== undefined) return { kind: "error", message: asError(error).message };
  return { kind: "loading" };
};

export type PropertyLine = { name: string; value: string };

/** An item's properties that hold a value, as text: the binder's properties in its order, then any it doesn't define. */
export const propertyLines = (item: Item, binders: readonly BinderSummary[] | undefined): PropertyLine[] => {
  const binder = binders?.find((each) => each.id === item.binder);
  const defined = binder?.id === null || binder === undefined ? {} : binder.properties;
  const names = [...Object.keys(defined), ...Object.keys(item.properties).filter((name) => !Object.hasOwn(defined, name))];
  return names
    .map((name) => ({ name, value: displayValue(Object.hasOwn(defined, name) ? defined[name] : undefined, item.properties[name]) }))
    .filter(({ value }) => value !== "");
};

/** What the preview calls the item it can't show: the listing's handle, the ref when it's a handle, else "This item". */
export const previewName = (itemRef: string, listed?: ItemSummary): string => {
  const name = listed === undefined ? itemRef : (listed.handle ?? undefined);
  return name === undefined || isItemId(name) ? "This item" : name;
};

/** What a row's box previews: an item row's item by id (or, without one, its path, which isn't read) and its listing. */
export type PreviewTarget = { itemRef: string; listed: ItemSummary };

/** The box of a row; none for a pending create or a missing item. */
export const rowPreview = (row: Row): PreviewTarget | undefined => (isItemRow(row) ? { itemRef: row.item.id ?? row.item.path, listed: row.item } : undefined);

/**
 * The box's keyboard mode: once Space turns it on, the box follows the focus through the view, hidden on rows without
 * one, until Space, Escape, Enter or the focus leaving the view turns it off. `openKey`: the row it's open on.
 */
export type PreviewKeys = { on: boolean; openKey: string | undefined };

/** Space on row `key`: turns the box off when it's on or open there, else on and open there when the row has one. */
export const previewOnSpace = ({ on, openKey }: PreviewKeys, key: string, previewable: boolean): { on: boolean; action: "open" | "close" } =>
  !on && openKey !== key && previewable ? { on: true, action: "open" } : { on: false, action: "close" };

/** Focus moving to row `key`: while on, the box shows there, or hides on a row without one; otherwise nothing. */
export const previewOnFocus = ({ on, openKey }: PreviewKeys, key: string, previewable: boolean): "open" | "close" | undefined => {
  if (!on) return undefined;
  if (!previewable) return openKey === undefined ? undefined : "close";
  return openKey === key ? undefined : "open";
};
