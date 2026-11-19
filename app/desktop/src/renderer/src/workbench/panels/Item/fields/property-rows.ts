// An item's fields as its tab shows them, pure: one row per property its binder declares.
import type { ItemSummary, LenientProperty, Problem } from "@wombat/shared/items";

import { problemsByField } from "../../Desk/view-model/problems.ts";
import { displayValue, linkValue } from "../../Desk/view-model/values.ts";

/** A link's target: found (its binder, id, handle and title when its binder's list holds it), or not found. */
export type LinkTarget = { found: true; binderId: string; itemId: string; handle: string; title: string | undefined } | { found: false };

export type PropertyRow = { name: string; text: string; link: LinkTarget | undefined; problems: Problem[] };

const linkTarget = (property: LenientProperty | undefined, value: unknown, listed: (binderId: string) => readonly ItemSummary[] | undefined): LinkTarget | undefined => {
  const link = linkValue(value);
  if (property?.type !== "link" || link === undefined) return undefined;
  if (link.handle === null) return { found: false };
  const title = listed(property.to)?.find(({ id }) => id === link.id)?.title ?? undefined;
  return { found: true, binderId: property.to, itemId: link.id, handle: link.handle, title };
};

/**
 * The rows in the order the binder's settings declare the properties, with no value too, and each problem at its
 * property's row; `rest` holds the problems of no declared property (the file's, the title's, an unknown property's).
 */
export const propertyRows = (
  properties: Readonly<Record<string, LenientProperty>>,
  item: Pick<ItemSummary, "properties" | "problems">,
  listed: (binderId: string) => readonly ItemSummary[] | undefined,
): { rows: PropertyRow[]; rest: Problem[] } => {
  const names = Object.keys(properties);
  const { at, rest } = problemsByField(item.problems, names);
  const rows = names.map((name) => {
    const property = properties[name];
    const value = Object.hasOwn(item.properties, name) ? item.properties[name] : undefined;
    return { name, text: displayValue(property, value), link: linkTarget(property, value, listed), problems: at.get(name) ?? [] };
  });
  return { rows, rest };
};
