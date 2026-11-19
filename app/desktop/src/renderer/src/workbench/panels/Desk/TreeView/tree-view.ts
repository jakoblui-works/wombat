import { type FlatRow, flatTree } from "../tree-keys.ts";
import type { TreeRow } from "../view-model/view-model.ts";

export type ItemTreeRow = FlatRow<TreeRow>;

/** The rows a tree view shows, in order: every row open unless its key is in `closed`. */
export const visibleTreeRows = (tree: readonly TreeRow[], closed: ReadonlySet<string>): ItemTreeRow[] =>
  flatTree(tree, { key: ({ item }) => item.path, children: ({ children }) => children, expanded: (_node, key) => !closed.has(key) });

export const setClosed = (closed: ReadonlySet<string>, key: string, open: boolean): Set<string> => {
  const next = new Set(closed);
  if (open) next.delete(key);
  else next.add(key);
  return next;
};
