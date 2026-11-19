import { type FlatRow, flatTree } from "../tree-keys.ts";
import { rowKey, type TreeRow } from "../view-model/view-model.ts";
import { showsProposal } from "../view-model/with-proposals.ts";

export type ItemTreeRow = FlatRow<TreeRow>;

/** The rows a tree view shows, in order: every row open unless its key is in `closed`. */
export const visibleTreeRows = (tree: readonly TreeRow[], closed: ReadonlySet<string>): ItemTreeRow[] =>
  flatTree(tree, { key: rowKey, children: ({ children }) => children, expanded: (_node, key) => !closed.has(key) });

export const setClosed = (closed: ReadonlySet<string>, key: string, open: boolean): Set<string> => {
  const next = new Set(closed);
  if (open) next.delete(key);
  else next.add(key);
  return next;
};

/** The keys of the rows above the one showing proposal `target`, top first; undefined while no row shows it. */
export const ancestorsOf = (tree: readonly TreeRow[], target: string): string[] | undefined => {
  for (const node of tree) {
    if (showsProposal(node, target)) return [];
    const below = ancestorsOf(node.children, target);
    if (below !== undefined) return [rowKey(node), ...below];
  }
  return undefined;
};

/** `closed` with every row in `keys` open. */
export const opened = (closed: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> =>
  keys.some((key) => closed.has(key)) ? new Set([...closed].filter((key) => !keys.includes(key))) : closed;
