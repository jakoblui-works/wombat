// The rows a binder's views show, pure: which items, in what order, grouped or nested.
import type { ItemSummary, LenientProperty, LenientView } from "@wombat/shared/items";

import { compareHandles, compareValues, displayValue, linkValue, matchesFilter, valueRank } from "./values.ts";

type Properties = Readonly<Record<string, LenientProperty>>;

export type Row = { item: ItemSummary };

/** The list a binder without a list or tree view shows: every item, by handle number. */
export const PLAIN_LIST: Extract<LenientView, { kind: "list" }> = { name: "Items", kind: "list" };

/** `value`: the group's value as items hold it; `none`: the items without a value; `all`: a view without `group`. */
export type Group = { key: string; rows: Row[] } & ({ kind: "value"; value: unknown } | { kind: "none" } | { kind: "all" });

export type TreeRow = Row & { children: TreeRow[] };

const byPath = (a: ItemSummary, b: ItemSummary): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The items whose every property in the view's filter matches its value (`matchesFilter`). */
export const visibleItems = (items: readonly ItemSummary[], view: LenientView): ItemSummary[] => {
  const filter = Object.entries(view.filter ?? {});
  return items.filter((item) => filter.every(([name, want]) => matchesFilter(item.properties[name], want)));
};

/** The items by each of the view's sort properties in order, then by handle number. */
export const sorted = (items: readonly ItemSummary[], view: LenientView, properties: Properties): ItemSummary[] => {
  const sortBy = view.sort ?? [];
  return [...items].sort((a, b) => {
    for (const name of sortBy) {
      const by = compareValues(properties[name], a.properties[name], b.properties[name]);
      if (by !== 0) return by;
    }
    return compareHandles(a.handle, b.handle) || byPath(a, b);
  });
};

const rowsOf = (items: readonly ItemSummary[]): Row[] => items.map((item) => ({ item }));

/**
 * The view's visible items, sorted, in groups by its `group` property: one per select option in option order (empty
 * ones too), or one per distinct value in ascending order, then one for the items without a value (only when it has
 * any). Without `group`, one group of every visible item.
 */
export const listGroups = (items: readonly ItemSummary[], view: LenientView, properties: Properties): Group[] => {
  const shown = sorted(visibleItems(items, view), view, properties);
  const name = view.kind === "list" ? view.group : undefined;
  if (name === undefined) return [{ key: "all", kind: "all", rows: rowsOf(shown) }];
  const property = properties[name];

  const groups = new Map<string, Extract<Group, { kind: "value" }>>();
  if (property?.type === "select") {
    for (const option of property.options) groups.set(String(property.options.indexOf(option)), { key: `value:${option}`, kind: "value", value: option, rows: [] });
  }
  const none: Row[] = [];
  const withValue: ItemSummary[] = [];
  for (const item of shown) {
    if (valueRank(property, item.properties[name]) === undefined) none.push({ item });
    else withValue.push(item);
  }
  const byValue = [...withValue].sort((a, b) => compareValues(property, a.properties[name], b.properties[name]));
  for (const item of byValue) {
    const value = item.properties[name];
    const rank = String(valueRank(property, value));
    const group = groups.get(rank) ?? { key: `value:${rank}`, kind: "value" as const, value, rows: [] };
    groups.set(rank, group);
  }
  for (const item of withValue) groups.get(String(valueRank(property, item.properties[name])))?.rows.push({ item });
  return [...groups.values(), ...(none.length > 0 ? [{ key: "none", kind: "none" as const, rows: none }] : [])];
};

/** The groups a list shows: those holding items. */
export const shownGroups = (groups: readonly Group[]): Group[] => groups.filter(({ rows }) => rows.length > 0);

/** A group's heading: its value as text, "No <property>" for the items without one; none without `group`. */
export const groupHeading = (group: Group, view: LenientView, properties: Properties): string | undefined => {
  const name = view.kind === "list" ? view.group : undefined;
  if (group.kind === "all" || name === undefined) return undefined;
  return group.kind === "none" ? `No ${name}` : displayValue(properties[name], group.value);
};

/**
 * The view's visible items, sorted, each under the item its `parent` link names. An item whose parent is missing,
 * filtered out or itself sits at the top; a cycle is cut where a walk up its links first repeats an item, which then
 * sits at the top. Top rows and siblings keep the sort order.
 */
export const treeRows = (items: readonly ItemSummary[], view: LenientView, properties: Properties = {}): TreeRow[] => {
  const shown = sorted(visibleItems(items, view), view, properties);
  const link = view.kind === "tree" ? view.parent : undefined;
  const byId = new Map<string, ItemSummary>();
  for (const item of shown) if (item.id !== null) byId.set(item.id, item);
  const parentOf = new Map<ItemSummary, ItemSummary>();
  if (link !== undefined) {
    for (const item of shown) {
      const id = linkValue(item.properties[link])?.id;
      const parent = id === undefined ? undefined : byId.get(id);
      if (parent !== undefined && parent !== item) parentOf.set(item, parent);
    }
  }
  const children = new Map<ItemSummary, ItemSummary[]>();
  for (const item of shown) {
    const parent = parentOf.get(item);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), item]);
  }

  const placed = new Set<ItemSummary>();
  const build = (item: ItemSummary): TreeRow => {
    placed.add(item);
    const under = (children.get(item) ?? []).filter((child) => !placed.has(child));
    return { item, children: under.map(build) };
  };
  const top = new Map<ItemSummary, TreeRow>();
  for (const item of shown) if (!parentOf.has(item)) top.set(item, build(item));
  for (const item of shown) {
    if (placed.has(item)) continue;
    const walked = new Set<ItemSummary>();
    let at = item;
    while (!walked.has(at)) {
      walked.add(at);
      at = parentOf.get(at) ?? at;
    }
    top.set(at, build(at));
  }
  return shown.flatMap((item) => top.get(item) ?? []);
};
