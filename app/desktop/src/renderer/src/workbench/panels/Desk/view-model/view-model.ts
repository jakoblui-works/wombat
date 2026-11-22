// The rows a binder's views show, pure: which items, in what order, grouped or nested.
import type { ItemSummary, LenientProperty, LenientView, LinkValue } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";

import { compareHandles, compareValues, displayValue, linkValue, matchesFilter, valueRank } from "./values.ts";

export type Properties = Readonly<Record<string, LenientProperty>>;

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

/** The item a row shows, with its id; undefined for a row without one or an item that can't be parsed. */
export const rowItem = (row: Row): (ItemSummary & { id: string }) | undefined => {
  if (!isItemRow(row)) return undefined;
  const { item } = row;
  return item.id === null ? undefined : { ...item, id: item.id };
};

/** The id of the item a row shows (`rowItem`). */
export const rowItemId = (row: Row): string | undefined => rowItem(row)?.id;

/** Whether reveal target `target` (a proposal id or an item id) lands on `row`. */
export const revealsRow = (row: Row, target: string): boolean => rowItemId(row) === target || rowProposals(row).some(({ id }) => id === target);

/** The value a row holds for property or field `name`; a missing item's row holds none. */
export const rowValue = (row: Row, name: string, properties: Properties): unknown => {
  if (isItemRow(row)) return row.item.properties[name];
  if (!isPending(row)) return undefined;
  const value = row.fields[name];
  const property = properties[name];
  return property?.type === "link" && typeof value === "string" ? row.link(property.to, value) : value;
};

/** A view as the sidebar shows it: a list or a tree. */
export type SidebarView = Extract<LenientView, { kind: "list" | "tree" }>;
export type SidebarList = Extract<SidebarView, { kind: "list" }>;
export type SidebarTree = Extract<SidebarView, { kind: "tree" }>;

/** The property a view lays its items out by: a list's group, a tree's parent link. */
export const laidOutBy = (view: SidebarView): string | undefined => {
  switch (view.kind) {
    case "list":
      return view.group;
    case "tree":
      return view.parent;
    default:
      return view satisfies never;
  }
};

/** The list a binder without views shows: every item, by handle number. */
export const PLAIN_LIST: SidebarList = { name: "Items", kind: "list" };

/**
 * The view the sidebar shows a binder in: a list or a tree as it is; a board as a list with the same name, filter,
 * sort and excerpt, grouped by its column; no view as `PLAIN_LIST`.
 */
export const sidebarView = (view: LenientView | undefined): SidebarView => {
  if (view === undefined) return PLAIN_LIST;
  if (view.kind !== "board") return view;
  const { column, ...rest } = view;
  return { ...rest, kind: "list", group: column };
};

/**
 * `value`: the group's value as items hold it; `none`: the items without a value; `all`: a view without `group`;
 * `outside`: the rows holding an open proposal the view's filter would hide, before every other group. `heading`: the
 * value as text, or "No <property>".
 */
export type Group = { key: string; rows: Row[] } & ({ kind: "value"; value: unknown; heading: string } | { kind: "none"; heading: string } | { kind: "all" } | { kind: "outside" });

/** A group shown under a heading of its own. */
export type HeadedGroup = Extract<Group, { heading: string }>;

export const hasHeading = (group: Group): group is HeadedGroup => "heading" in group;

export type TreeRow = Row & { children: TreeRow[] };

const byKey = (a: Row, b: Row): number => {
  const [x, y] = [rowKey(a), rowKey(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

const passes = (row: Row, view: LenientView, properties: Properties): boolean =>
  Object.entries(view.filter ?? {}).every(([name, want]) => matchesFilter(rowValue(row, name, properties), want));

/** The rows whose every property in the view's filter matches its value (`matchesFilter`). */
export const visibleItems = <R extends Row>(rows: readonly R[], view: LenientView, properties: Properties = {}): R[] => rows.filter((row) => passes(row, view, properties));

/**
 * Whether the view's filter would hide `row` and it shows anyway, before every other row: it holds an open proposal, or
 * reveal target `revealed` lands on it (`revealsRow`).
 */
export const isOutsideFilter = (row: Row, view: LenientView, properties: Properties, revealed?: string): boolean =>
  (rowProposals(row).length > 0 || (revealed !== undefined && revealsRow(row, revealed))) && !passes(row, view, properties);

/** The rows the view's filter would hide that show anyway (`isOutsideFilter`). */
export const outsideFilter = <R extends Row>(rows: readonly R[], view: LenientView, properties: Properties, revealed?: string): R[] =>
  rows.filter((row) => isOutsideFilter(row, view, properties, revealed));

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
export const shownRows = (rows: readonly Row[], view: LenientView, properties: Properties, revealed?: string): { outside: Row[]; shown: Row[] } => {
  const outside = outsideFilter(rows, view, properties, revealed);
  return {
    outside: [...sorted(outside.filter(isPending), view, properties), ...sorted(outside.filter((row) => !isPending(row)), view, properties)],
    shown: sorted(visibleItems(rows, view, properties), view, properties),
  };
};

/**
 * The view's visible rows, sorted, in groups by its `group` property: one per select option in option order (empty
 * ones too), or one per distinct value in ascending order, then one for the rows without a value (only when it has
 * any). Without `group`, one group of every visible row. The rows its filter hides that show anyway (`isOutsideFilter`,
 * with `revealed`) come first, in a group of their own (`outside`).
 */
export const listGroups = (rows: readonly Row[], view: SidebarList, properties: Properties, revealed?: string): Group[] => {
  const { outside, shown } = shownRows(rows, view, properties, revealed);
  const first: Group[] = outside.length > 0 ? [{ key: "outside", kind: "outside", rows: outside }] : [];
  const name = laidOutBy(view);
  if (name === undefined) return [...first, { key: "all", kind: "all", rows: shown }];
  const property = properties[name];

  const groups = new Map<string, Extract<Group, { kind: "value" }>>();
  if (property?.type === "select") {
    for (const option of property.options) groups.set(String(property.options.indexOf(option)), { key: `value:${option}`, kind: "value", value: option, heading: displayValue(property, option), rows: [] });
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
    const group = groups.get(rank) ?? { key: `value:${rank}`, kind: "value" as const, value, heading: displayValue(property, value), rows: [] };
    groups.set(rank, group);
  }
  for (const row of withValue) groups.get(String(valueRank(property, rowValue(row, name, properties))))?.rows.push(row);
  return [...first, ...groups.values(), ...(none.length > 0 ? [{ key: "none", kind: "none" as const, heading: `No ${name}`, rows: none }] : [])];
};

/** What a list's group counts: its items, not a proposed create nor a missing item. */
export const itemCount = (rows: readonly Row[]): number => rows.filter(isItemRow).length;

/** The groups a list shows: those holding items. */
export const shownGroups = (groups: readonly Group[]): Group[] => groups.filter(({ rows }) => rows.length > 0);

/**
 * The view's visible rows, sorted, each under the item its `parent` link names. A row whose parent is missing,
 * filtered out or itself sits at the top; a cycle is cut where a walk up its links first repeats an item, which then
 * sits at the top. Top rows and siblings keep the sort order. The rows its filter hides that show anyway
 * (`isOutsideFilter`, with `revealed`) come first, at the top.
 */
export const treeRows = (rows: readonly Row[], view: SidebarTree, properties: Properties = {}, revealed?: string): TreeRow[] => {
  const { outside, shown } = shownRows(rows, view, properties, revealed);
  const link = laidOutBy(view);
  const byId = new Map<string, Row>();
  for (const row of shown) {
    const id = rowItemId(row);
    if (id !== undefined) byId.set(id, row);
  }
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

/** An item row whose item can be a new item's parent: it has an id. */
export type ParentRow = ItemRow & { item: { id: string } };

/** Whether a tree row offers "New child". */
export const offersNewChild = (row: Row): row is ParentRow => rowItem(row) !== undefined;

/** Where "+ New" was asked: a group's header (by its value), or a row (its item becomes the new one's parent). */
export type NewItemPlace = HeadedGroup | ParentRow;

/** The name of a group's "+ New", by its heading. */
export const newItemLabel = (heading: string): string => `New item in ${heading}`;

/** Opens a new item starting with `context` (`viewContext`). */
export type NewItem = (context: Record<string, unknown>) => void;

/**
 * The values a new item asked for in `view` starts with: the view's filter values, then the place's: a group's value
 * for the view's group property (nothing for the items without one), or the row's item as the tree's parent link.
 */
export const viewContext = (view: SidebarView, place?: NewItemPlace): Record<string, unknown> => {
  const context: Record<string, unknown> = { ...view.filter };
  const property = laidOutBy(view);
  if (place === undefined || property === undefined) return context;
  if ("item" in place) {
    if (view.kind === "tree") context[property] = { id: place.item.id, handle: place.item.handle };
  } else if (place.kind === "value" && view.kind === "list") context[property] = place.value;
  return context;
};
