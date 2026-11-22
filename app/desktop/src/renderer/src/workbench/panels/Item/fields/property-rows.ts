// An item's fields as its tab shows them, pure: one row per property its binder declares.
import type { ItemSummary, LenientProperty, Problem } from "@wombat/shared/items";

import { problemsByField } from "../../../items/problems.ts";

export type PropertyRow = { name: string; problems: Problem[] };

/**
 * The rows in the order the binder's settings declare the properties, with no value too, and each problem at its
 * property's row; `rest` holds the problems of no declared property (the file's, the title's, an unknown property's).
 */
export const propertyRows = (properties: Readonly<Record<string, LenientProperty>>, item: Pick<ItemSummary, "problems">): { rows: PropertyRow[]; rest: Problem[] } => {
  const names = Object.keys(properties);
  const { at, rest } = problemsByField(item.problems, names);
  return { rows: names.map((name) => ({ name, problems: at.get(name) ?? [] })), rest };
};
