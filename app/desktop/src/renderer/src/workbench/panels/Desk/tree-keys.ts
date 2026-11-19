// The WAI-ARIA tree pattern's keys over a tree's visible rows, pure.

/** A visible row: the index of the row it sits under, and `expanded` only when it has children. */
export type KeyRow = { parent: number | undefined; expanded: boolean | undefined };

export type TreeKeyAction = { type: "focus"; index: number } | { type: "toggle"; open: boolean } | { type: "activate" };

/**
 * What a key does on row `index`; undefined when it does nothing there. `toggles` says whether the row opens and
 * closes by the arrows (a row that always shows its children doesn't).
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
    case "Enter":
    case " ":
      return { type: "activate" };
    default:
      return undefined;
  }
};
