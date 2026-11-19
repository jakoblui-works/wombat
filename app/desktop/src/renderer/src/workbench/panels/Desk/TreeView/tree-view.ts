import type { TreeRow } from "../view-model/view-model.ts";

/** One visible row; `expanded` only for a row with children. */
export type ItemTreeRow = { item: TreeRow["item"]; key: string; level: number; parent: number | undefined; setSize: number; posInSet: number; expanded: boolean | undefined };

/** The rows a tree view shows, in order: every row open unless its key is in `closed`. */
export const visibleTreeRows = (tree: readonly TreeRow[], closed: ReadonlySet<string>): ItemTreeRow[] => {
  const rows: ItemTreeRow[] = [];
  const walk = (list: readonly TreeRow[], level: number, parent: number | undefined): void => {
    list.forEach(({ item, children }, index) => {
      const key = item.path;
      const expanded = children.length === 0 ? undefined : !closed.has(key);
      rows.push({ item, key, level, parent, setSize: list.length, posInSet: index + 1, expanded });
      if (expanded === true) walk(children, level + 1, rows.length - 1);
    });
  };
  walk(tree, 1, undefined);
  return rows;
};

export const setClosed = (closed: ReadonlySet<string>, key: string, open: boolean): Set<string> => {
  const next = new Set(closed);
  if (open) next.delete(key);
  else next.add(key);
  return next;
};
