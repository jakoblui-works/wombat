// The rows a binder's views show, pure: which items, in what order, grouped or nested.
import type { ItemSummary, LenientProperty, LenientView, LinkValue } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";

import { compareHandles, compareValues, displayValue, linkValue, matchesFilter, valueRank } from "./values.ts";

type Properties = Readonly<Record<string, LenientProperty>>;

export type ItemRow = {
  item: ItemSummary;
  /** The open updates and deletes proposed on the item, oldest first; `proposal`, its mark, is the first. */
  proposals?: readonly ItemProposal[];
  proposal?: ItemProposal;
};
/** `fields`: the create's latest version's, a link as the target's bare id; `link` names the target as items hold it. */
export type PendingRow = { pending: ItemProposal; fields: Readonly<Record<string, unknown>>; link: LinkTarget };

/** The link to item `id` of binder `to`, as items hold it: its handle null when no such item is read. */
export type LinkTarget = (to: string, id: string) => LinkValue;

/** The items a link to binder `binderId` may name. */
export type ItemsOf = (binderId: string) => readonly ItemSummary[];
/** The open updates and deletes proposed on handle `missing`, which names no item (its file deleted or renamed by hand), oldest first. */
export type MissingRow = { missing: string; proposals: readonly ItemProposal[] };
export type Row = ItemRow | PendingRow | MissingRow;

export const isItemRow = (row: Row): row is ItemRow => "item" in row;
export const isPending = (row: Row): row is PendingRow => "pending" in row;

/** What a row is keyed by: its item's path, its create's id or its missing handle, each kind apart from the others. */
export const rowKey = (row: Row): string => (isItemRow(row) ? row.item.path : isPending(row) ? `proposal:${row.pending.id}` : `missing:${row.missing}`);

/** The open proposals a row shows: its create, or the updates and deletes on its item, oldest first. */
export const rowProposals = (row: Row): readonly ItemProposal[] => (isPending(row) ? [row.pending] : (row.proposals ?? []));

/** The value a row holds for property or field `name`; a missing item's row holds none. */
export const rowValue = (row: Row, name: string, properties: Properties): unknown => {
  if (isItemRow(row)) return row.item.properties[name];
  if (!isPending(row)) return undefined;
  const value = row.fields[name];
  const property = properties[name];
  return property?.type === "link" && typeof value === "string" ? row.link(property.to, value) : value;
};

/** The list a binder without a list or tree view shows: every item, by handle number. */
export const PLAIN_LIST: Extract<LenientView, { kind: "list" }> = { name: "Items", kind: "list" };

/** The view the sidebar shows a binder in: `view` when it's a list or a tree, else `PLAIN_LIST`. */
export const paneView = (view: LenientView | undefined): Extract<LenientView, { kind: "list" | "tree" }> =>
  view?.kind === "list" || view?.kind === "tree" ? view : PLAIN_LIST;

/**
 * `value`: the group's value as items hold it; `none`: the items without a value; `all`: a view without `group`;
 * `outside`: the rows holding an open proposal the view's filter would hide, before every other group.
 */
export type Group = { key: string; rows: Row[] } & ({ kind: "value"; value: unknown } | { kind: "none" } | { kind: "all" } | { kind: "outside" });

export type TreeRow = Row & { children: TreeRow[] };

const byKey = (a: Row, b: Row): number => {
  const [x, y] = [rowKey(a), rowKey(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

const passes = (row: Row, view: LenientView, properties: Properties): boolean =>
  Object.entries(view.filter ?? {}).every(([name, want]) => matchesFilter(rowValue(row, name, properties), want));

/** The rows whose every property in the view's filter matches its value (`matchesFilter`). */
export const visibleItems = <R extends Row>(rows: readonly R[], view: LenientView, properties: Properties = {}): R[] => rows.filter((row) => passes(row, view, properties));

/** Whether `row` holds an open proposal and the view's filter would hide it: it shows anyway, before every other row. */
export const isOutsideFilter = (row: Row, view: LenientView, properties: Properties): boolean => rowProposals(row).length > 0 && !passes(row, view, properties);

/** The rows holding an open proposal the view's filter would hide (`isOutsideFilter`). */
export const outsideFilter = <R extends Row>(rows: readonly R[], view: LenientView, properties: Properties): R[] => rows.filter((row) => isOutsideFilter(row, view, properties));

/** The rows by each of the view's sort properties in order, then by handle number (a row without an item after every handle). */
export const sorted = <R extends Row>(rows: readonly R[], view: LenientView, properties: Properties): R[] => {
  const sortBy = view.sort ?? [];
  const handleOf = (row: Row): string | null => (isItemRow(row) ? row.item.handle : null);
  return [...rows].sort((a, b) => {
    for (const name of sortBy) {
      const by = compareValues(properties[name], rowValue(a, name, properties), rowValue(b, name, properties));
      if (by !== 0) return by;
    }
    return compareHandles(handleOf(a), handleOf(b)) || byKey(a, b);
  });
};

/** The rows a view shows, in order: those outside its filter (`outsideFilter`; proposed creates first), then the visible rows. */
export const shownRows = (rows: readonly Row[], view: LenientView, properties: Properties): { outside: Row[]; shown: Row[] } => {
  const outside = outsideFilter(rows, view, properties);
  return {
    outside: [...sorted(outside.filter(isPending), view, properties), ...sorted(outside.filter((row) => !isPending(row)), view, properties)],
    shown: sorted(visibleItems(rows, view, properties), view, properties),
  };
};

/**
 * The view's visible rows, sorted, in groups by its `group` property: one per select option in option order (empty
 * ones too), or one per distinct value in ascending order, then one for the rows without a value (only when it has
 * any). Without `group`, one group of every visible row. The rows holding an open proposal its filter hides come
 * first, in a group of their own (`outside`).
 */
export const listGroups = (rows: readonly Row[], view: LenientView, properties: Properties): Group[] => {
  const { outside, shown } = shownRows(rows, view, properties);
  const first: Group[] = outside.length > 0 ? [{ key: "outside", kind: "outside", rows: outside }] : [];
  const name = view.kind === "list" ? view.group : undefined;
  if (name === undefined) return [...first, { key: "all", kind: "all", rows: shown }];
  const property = properties[name];

  const groups = new Map<string, Extract<Group, { kind: "value" }>>();
  if (property?.type === "select") {
    for (const option of property.options) groups.set(String(property.options.indexOf(option)), { key: `value:${option}`, kind: "value", value: option, rows: [] });
  }
  const none: Row[] = [];
  const withValue: Row[] = [];
  for (const row of shown) {
    if (valueRank(property, rowValue(row, name, properties)) === undefined) none.push(row);
    else withValue.push(row);
  }
  const byValue = [...withValue].sort((a, b) => compareValues(property, rowValue(a, name, properties), rowValue(b, name, properties)));
  for (const row of byValue) {
    const value = rowValue(row, name, properties);
    const rank = String(valueRank(property, value));
    const group = groups.get(rank) ?? { key: `value:${rank}`, kind: "value" as const, value, rows: [] };
    groups.set(rank, group);
  }
  for (const row of withValue) groups.get(String(valueRank(property, rowValue(row, name, properties))))?.rows.push(row);
  return [...first, ...groups.values(), ...(none.length > 0 ? [{ key: "none", kind: "none" as const, rows: none }] : [])];
};

/** The groups a list shows: those holding items. */
export const shownGroups = (groups: readonly Group[]): Group[] => groups.filter(({ rows }) => rows.length > 0);

/** A group's heading: its value as text, "No <property>" for the items without one; none without `group`, nor for `outside`. */
export const groupHeading = (group: Group, view: LenientView, properties: Properties): string | undefined => {
  const name = view.kind === "list" ? view.group : undefined;
  if (group.kind === "all" || group.kind === "outside" || name === undefined) return undefined;
  return group.kind === "none" ? `No ${name}` : displayValue(properties[name], group.value);
};

/**
 * The view's visible rows, sorted, each under the item its `parent` link names. A row whose parent is missing,
 * filtered out or itself sits at the top; a cycle is cut where a walk up its links first repeats an item, which then
 * sits at the top. Top rows and siblings keep the sort order. The rows holding an open proposal its filter hides come
 * first, at the top.
 */
export const treeRows = (rows: readonly Row[], view: LenientView, properties: Properties = {}): TreeRow[] => {
  const { outside, shown } = shownRows(rows, view, properties);
  const link = view.kind === "tree" ? view.parent : undefined;
  const byId = new Map<string, Row>();
  for (const row of shown) if (isItemRow(row) && row.item.id !== null) byId.set(row.item.id, row);
  const parentOf = new Map<Row, Row>();
  if (link !== undefined) {
    for (const row of shown) {
      const id = linkValue(rowValue(row, link, properties))?.id;
      const parent = id === undefined ? undefined : byId.get(id);
      if (parent !== undefined && parent !== row) parentOf.set(row, parent);
    }
  }
  const children = new Map<Row, Row[]>();
  for (const row of shown) {
    const parent = parentOf.get(row);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), row]);
  }

  const placed = new Set<Row>();
  const build = (row: Row): TreeRow => {
    placed.add(row);
    const under = (children.get(row) ?? []).filter((child) => !placed.has(child));
    return { ...row, children: under.map(build) };
  };
  const top = new Map<Row, TreeRow>();
  for (const row of shown) if (!parentOf.has(row)) top.set(row, build(row));
  for (const row of shown) {
    if (placed.has(row)) continue;
    const walked = new Set<Row>();
    let at = row;
    while (!walked.has(at)) {
      walked.add(at);
      at = parentOf.get(at) ?? at;
    }
    top.set(at, build(at));
  }
  return [...outside.map((row) => ({ ...row, children: [] })), ...shown.flatMap((row) => top.get(row) ?? [])];
};

/** Where "+ New" was asked: a group or a board's column (by its value), or a row (its item becomes the new one's parent). */
export type NewItemPlace = { kind: "value"; value: unknown } | { kind: "none" } | { kind: "all" } | { kind: "outside" } | ItemRow;

/** Whether a group or column offers "+ New": every group of a list but `outside`, a board's columns but its No value. */
export const offersNew = (view: LenientView, place: Pick<Group, "kind">): boolean => (view.kind !== "board" || place.kind === "value") && place.kind !== "outside";

/** The name of a group's or column's "+ New", by its heading. */
export const newItemLabel = (heading: string): string => `New item in ${heading}`;

/** Opens a new item starting with `context` (`viewContext`). */
export type NewItem = (context: Record<string, unknown>) => void;

/**
 * The values a new item asked for in `view` starts with: the view's filter values, then the place's: a group's or
 * column's value for the view's group or column property (nothing for the items without one), or the row's item as the
 * tree's parent link.
 */
export const viewContext = (view: LenientView, place?: NewItemPlace): Record<string, unknown> => {
  const context: Record<string, unknown> = { ...view.filter };
  if (place === undefined) return context;
  if ("item" in place) {
    if (view.kind === "tree" && place.item.id !== null) context[view.parent] = { id: place.item.id, handle: place.item.handle };
    return context;
  }
  const property = view.kind === "list" ? view.group : view.kind === "board" ? view.column : undefined;
  if (place.kind === "value" && property !== undefined) context[property] = place.value;
  return context;
};
