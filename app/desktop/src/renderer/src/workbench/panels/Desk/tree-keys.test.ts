// The Desk tree and a binder's tree view move, open and close by the same keys (the WAI-ARIA tree pattern): the
// arrows move, ArrowRight opens a closed row and then moves to its first child, ArrowLeft closes an open row and then
// moves to its parent, and Home and End jump; Enter and Space are left to the tree, neither moving nor toggling.
import { describe, expect, test } from "vitest";

import { flatTree, type TreeKeyAction, treeKey } from "./tree-keys.ts";

type Node = { name: string; children: Node[] };
const node = (name: string, children: Node[] = []): Node => ({ name, children });

// Shown rows: 0 Atlas (open), 1 Atlas notes, 2 Atlas plans (closed, one child), 3 Beacon, 4 Cove (closed, one child).
const OPEN = new Set(["Atlas"]);
const rows = flatTree([node("Atlas", [node("Atlas notes"), node("Atlas plans", [node("Atlas plans draft")])]), node("Beacon"), node("Cove", [node("Cove log")])], {
  key: ({ name }) => name,
  children: ({ children }) => children,
  expanded: (_node, key) => OPEN.has(key),
});
const index = (name: string): number => {
  const at = rows.findIndex((row) => row.node.name === name);
  if (at < 0) throw new Error(`${name} isn't a shown row`);
  return at;
};

describe("treeKey", () => {
  test.each<{ what: string; on: string; key: string; does: TreeKeyAction | undefined; toggles?: boolean }>([
    { what: "ArrowDown moves to the next row", on: "Atlas", key: "ArrowDown", does: { type: "focus", index: index("Atlas notes") } },
    { what: "ArrowDown on the last row stays", on: "Cove", key: "ArrowDown", does: undefined },
    { what: "ArrowUp moves to the row before", on: "Beacon", key: "ArrowUp", does: { type: "focus", index: index("Atlas plans") } },
    { what: "ArrowUp on the first row stays", on: "Atlas", key: "ArrowUp", does: undefined },
    { what: "ArrowRight opens a closed row", on: "Cove", key: "ArrowRight", does: { type: "toggle", open: true } },
    { what: "ArrowRight on an open row moves to its first child", on: "Atlas", key: "ArrowRight", does: { type: "focus", index: index("Atlas notes") } },
    { what: "ArrowRight on a row without children does nothing", on: "Beacon", key: "ArrowRight", does: undefined },
    { what: "ArrowLeft closes an open row", on: "Atlas", key: "ArrowLeft", does: { type: "toggle", open: false } },
    { what: "ArrowLeft on a closed row moves to its parent", on: "Atlas plans", key: "ArrowLeft", does: { type: "focus", index: index("Atlas") } },
    { what: "ArrowLeft on a child moves to its parent", on: "Atlas notes", key: "ArrowLeft", does: { type: "focus", index: index("Atlas") } },
    { what: "ArrowLeft on a top row without children stays", on: "Beacon", key: "ArrowLeft", does: undefined },
    { what: "Home moves to the first row", on: "Beacon", key: "Home", does: { type: "focus", index: index("Atlas") } },
    { what: "End moves to the last row", on: "Atlas notes", key: "End", does: { type: "focus", index: index("Cove") } },
    { what: "Enter on an open row is left to the tree", on: "Atlas", key: "Enter", does: undefined },
    { what: "Enter on a closed row is left to the tree", on: "Cove", key: "Enter", does: undefined },
    { what: "Space on a row without children is left to the tree", on: "Beacon", key: " ", does: undefined },
    { what: "Space on a closed row is left to the tree", on: "Cove", key: " ", does: undefined },
    { what: "ArrowRight on a row that always shows its children moves to the first one", on: "Atlas", key: "ArrowRight", does: { type: "focus", index: index("Atlas notes") }, toggles: false },
    { what: "ArrowLeft on a row that always shows its children doesn't close it", on: "Atlas", key: "ArrowLeft", does: undefined, toggles: false },
  ])("$what", ({ on, key, does, toggles }) => {
    expect(treeKey(rows, index(on), key, toggles)).toEqual(does);
  });
});
