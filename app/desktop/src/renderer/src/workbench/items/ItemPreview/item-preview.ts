import { type BinderSummary, isItemId, type Item, type ItemSummary } from "@wombat/shared/items";

import { asError } from "../../../lib/errors.ts";
import { isItemNotFound } from "../reads.ts";
import { displayValue } from "../values.ts";

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
