import { type FlatRow, flatTree, keysAbove } from "../tree-keys.ts";
import { revealsRow, rowKey, type TreeRow } from "../view-model/view-model.ts";

export type ItemTreeRow = FlatRow<TreeRow>;

const TREE_SHAPE = { key: rowKey, children: ({ children }: TreeRow) => children };

/** The rows a tree view shows, in order: every row open unless its key is in `closed`. */
export const visibleTreeRows = (tree: readonly TreeRow[], closed: ReadonlySet<string>): ItemTreeRow[] =>
  flatTree(tree, { ...TREE_SHAPE, expanded: (_node, key) => !closed.has(key) });

/** The keys of the rows above the one `target` lands on (`revealsRow`), top first; undefined while no row shows it. */
export const ancestorsOf = (tree: readonly TreeRow[], target: string): string[] | undefined => keysAbove(tree, TREE_SHAPE, (node) => revealsRow(node, target));
