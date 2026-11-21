// The WAI-ARIA tree pattern over a tree's visible rows, pure: the rows, their indent and the keys.

/** A visible row: the index of the row it sits under, and `expanded` only when it has children. */
export type KeyRow = { parent: number | undefined; expanded: boolean | undefined };

/** One visible row of `node`; `expanded` only for a row with children. */
export type FlatRow<N> = KeyRow & { node: N; key: string; level: number; setSize: number; posInSet: number };

type TreeShape<N> = {
  key: (node: N) => string;
  children: (node: N) => readonly N[];
  /** Whether a node with children shows them. */
  expanded: (node: N, key: string) => boolean;
};

/** The rows a tree shows, in order: each node, then its children while it is expanded. */
export const flatTree = <N>(nodes: readonly N[], { key, children, expanded }: TreeShape<N>): FlatRow<N>[] => {
  const rows: FlatRow<N>[] = [];
  const walk = (list: readonly N[], level: number, parent: number | undefined): void => {
    list.forEach((node, index) => {
      const nodeKey = key(node);
      const under = children(node);
      const open = under.length === 0 ? undefined : expanded(node, nodeKey);
      rows.push({ node, key: nodeKey, level, parent, setSize: list.length, posInSet: index + 1, expanded: open });
      if (open === true) walk(under, level + 1, rows.length - 1);
    });
  };
  walk(nodes, 1, undefined);
  return rows;
};

const ROW_START_PX = 6;
const INDENT_PX = 12;

/** A row's left padding in pixels at its `level` (1 at the top). */
export const rowIndent = (level: number): number => ROW_START_PX + (level - 1) * INDENT_PX;

/** A row's first line: 20 px high, the title's line; the chevron, marks and counts line up with it. */
export const FIRST_LINE = "leading-5";

/** A box as high as a row's first line (`FIRST_LINE`), centring an icon in it. */
export const FIRST_LINE_BOX = "flex h-5 shrink-0 items-center";

/** A tree row's look: its text, hover and focus; its height and indent are the tree's own. */
export const TREE_ROW = `focus-ring cursor-default rounded-md pr-2 text-left text-base ${FIRST_LINE} select-none transition-colors hover:bg-surface-2 focus:bg-surface-2`;

/** A tree row's chevron, turned down while the row is open. */
export const treeChevron = (open: boolean): string => `size-3.5 shrink-0 text-fg-tertiary transition-transform${open ? " rotate-90" : ""}`;

export type TreeKeyAction = { type: "focus"; index: number } | { type: "toggle"; open: boolean };

/**
 * Where an arrow, Home or End key on row `index` moves the focus, or whether it folds the row; undefined for any other
 * key (Enter and Space too) and where the key does nothing. `toggles` says whether the row opens and closes by the
 * arrows (a row that always shows its children doesn't).
 */
export const treeKey = (rows: readonly KeyRow[], index: number, key: string, toggles = true): TreeKeyAction | undefined => {
  const row = rows[index];
  if (row === undefined) return undefined;
  const focus = (to: number | undefined): TreeKeyAction | undefined => (to === undefined || to === index || rows[to] === undefined ? undefined : { type: "focus", index: to });
  switch (key) {
    case "ArrowDown":
      return focus(index + 1);
    case "ArrowUp":
      return focus(index - 1);
    case "Home":
      return focus(0);
    case "End":
      return focus(rows.length - 1);
    case "ArrowRight":
      if (row.expanded === false && toggles) return { type: "toggle", open: true };
      return row.expanded === true ? focus(index + 1) : undefined;
    case "ArrowLeft":
      if (row.expanded === true && toggles) return { type: "toggle", open: false };
      return focus(row.parent);
    default:
      return undefined;
  }
};
