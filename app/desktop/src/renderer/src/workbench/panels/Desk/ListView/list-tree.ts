import { type FlatRow, flatTree, keysAbove } from "../tree-keys.ts";
import { type Group, hasHeading, type HeadedGroup, revealsRow, type Row, rowKey } from "../view-model/view-model.ts";

/** A list's row: a group's header, or one of its rows. */
export type ListNode = { kind: "group"; group: HeadedGroup } | { kind: "row"; row: Row };

export type VisibleRow = FlatRow<ListNode>;

const rowNode = (row: Row): ListNode => ({ kind: "row", row });

const LIST_SHAPE = {
  key: (node: ListNode): string => (node.kind === "group" ? `group:${node.group.key}` : rowKey(node.row)),
  children: (node: ListNode): ListNode[] => (node.kind === "group" ? node.group.rows.map(rowNode) : []),
};

/** The groups' headers, and the rows of the groups without one, in order. */
const listNodes = (groups: readonly Group[]): ListNode[] => groups.flatMap((group): ListNode[] => (hasHeading(group) ? [{ kind: "group", group }] : group.rows.map(rowNode)));

/** The keys of the headers above the row `target` lands on (`revealsRow`); undefined while no row shows it. */
export const listAncestorsOf = (groups: readonly Group[], target: string): string[] | undefined =>
  keysAbove(listNodes(groups), LIST_SHAPE, (node) => node.kind === "row" && revealsRow(node.row, target));

/**
 * The rows a list shows, in order, in the shape a tree's visible rows take: each group's header at level 1 with its
 * rows at level 2 unless its key is in `folded`; the groups without a header (a list without `group`, the rows outside
 * the filter) as level-1 rows.
 */
export const listTree = (groups: readonly Group[], folded: ReadonlySet<string>): VisibleRow[] =>
  flatTree(listNodes(groups), { ...LIST_SHAPE, expanded: (_node, key) => !folded.has(key) });
