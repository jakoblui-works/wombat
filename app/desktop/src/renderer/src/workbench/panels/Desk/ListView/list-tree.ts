import { type FlatRow, flatTree } from "../tree-keys.ts";
import { type Group, hasHeading, type HeadedGroup, revealsRow, type Row, rowKey } from "../view-model/view-model.ts";

/** A list's row: a group's header, or one of its rows. */
export type ListNode = { kind: "group"; group: HeadedGroup } | { kind: "row"; row: Row };

export type VisibleRow = FlatRow<ListNode>;

const headerKey = (group: Group): string => `group:${group.key}`;

const nodeKey = (node: ListNode): string => (node.kind === "group" ? headerKey(node.group) : rowKey(node.row));

const rowNode = (row: Row): ListNode => ({ kind: "row", row });

/** `folded` without the header of the group holding `reveal`'s row (`revealsRow`) (the same set when there is none to open): a reveal never leaves its row folded away. */
export const unfoldedFor = (groups: readonly Group[], folded: ReadonlySet<string>, reveal: string | undefined): ReadonlySet<string> => {
  if (reveal === undefined) return folded;
  const holder = groups.find((group) => hasHeading(group) && group.rows.some((row) => revealsRow(row, reveal)));
  const key = holder === undefined ? undefined : headerKey(holder);
  return key === undefined || !folded.has(key) ? folded : new Set([...folded].filter((each) => each !== key));
};

/**
 * The rows a list shows, in order, in the shape a tree's visible rows take: each group's header at level 1 with its
 * rows at level 2 unless its key is in `folded`; the groups without a header (a list without `group`, the rows outside
 * the filter) as level-1 rows.
 */
export const listTree = (groups: Group[], folded: ReadonlySet<string>): VisibleRow[] => {
  const nodes = groups.flatMap((group): ListNode[] => (hasHeading(group) ? [{ kind: "group", group }] : group.rows.map(rowNode)));
  return flatTree(nodes, {
    key: nodeKey,
    children: (node) => (node.kind === "group" ? node.group.rows.map(rowNode) : []),
    expanded: (_node, key) => !folded.has(key),
  });
};
