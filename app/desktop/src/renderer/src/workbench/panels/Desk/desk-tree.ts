// The Desk's tree, pure: which folders are drawers, how binders nest, the order, and the rows and keys of the tree.
import { type BinderSummary, type Problem, SETTINGS_FILE } from "@wombat/shared/items";

import { type FlatRow, flatTree, treeKey } from "./tree-keys.ts";
import { problemLocation } from "./view-model/problems.ts";
import { compareText } from "./view-model/values.ts";

export type DeskNode = { kind: "drawer"; name: string; path: string; children: DeskNode[] } | { kind: "binder"; binder: BinderSummary; children: DeskNode[] };

const ROOT = "";

/** What a broken binder at the items root is called. */
const ROOT_NAME = "Items folder";

const normalized = (path: string): string => (path === "." ? ROOT : path);
const parentPath = (path: string): string | undefined => (path === ROOT ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ROOT);
const folderName = (path: string): string => (path === ROOT ? ROOT_NAME : path.slice(path.lastIndexOf("/") + 1));

/** What a row is called: a drawer's folder, a binder's name, a broken binder's folder. */
export const nodeName = (node: DeskNode): string =>
  node.kind === "drawer" ? node.name : node.binder.id === null ? folderName(normalized(node.binder.path)) : node.binder.name;

/** A node's identity in the tree, and what the open set holds for a drawer. */
export const nodeKey = (node: DeskNode): string => (node.kind === "drawer" ? node.path : normalized(node.binder.path));

const byName = (a: DeskNode, b: DeskNode): number => compareText(nodeName(a), nodeName(b)) || compareText(nodeKey(a), nodeKey(b));

/**
 * The binders as a tree that follows their folders: the folders on the way to a binder are drawers, a binder inside
 * another binder's folder nests under it, and siblings are sorted by name. Items never appear.
 */
export const deskTree = (binders: readonly BinderSummary[]): DeskNode[] => {
  const binderAt = new Map<string, BinderSummary>();
  for (const binder of binders) {
    const path = normalized(binder.path);
    if (!binderAt.has(path)) binderAt.set(path, binder);
  }
  const nodes = new Map<string, DeskNode>();
  const nodeAt = (path: string): DeskNode => {
    const known = nodes.get(path);
    if (known !== undefined) return known;
    const binder = binderAt.get(path);
    const node: DeskNode = binder === undefined ? { kind: "drawer", name: folderName(path), path, children: [] } : { kind: "binder", binder, children: [] };
    nodes.set(path, node);
    return node;
  };
  const top: DeskNode[] = [];
  const place = (path: string): void => {
    if (nodes.has(path)) return;
    const node = nodeAt(path);
    const parent = parentPath(path);
    // The items root itself is a node only when it is a binder.
    if (parent === undefined || (parent === ROOT && !binderAt.has(ROOT))) {
      top.push(node);
      return;
    }
    place(parent);
    nodeAt(parent).children.push(node);
  };
  for (const path of binderAt.keys()) place(path);
  const sortAll = (list: DeskNode[]): DeskNode[] => {
    list.sort(byName);
    for (const node of list) sortAll(node.children);
    return list;
  };
  return sortAll(top);
};

export type DeskRow = FlatRow<DeskNode>;

/**
 * The rows the tree shows, in order, given the open drawers. A binder holding binders always shows them: only drawers
 * open and close.
 */
export const deskRows = (nodes: readonly DeskNode[], openDrawers: ReadonlySet<string>): DeskRow[] =>
  flatTree(nodes, { key: nodeKey, children: (node) => node.children, expanded: (node, key) => node.kind === "binder" || openDrawers.has(key) });

/** The open drawers with `path` opened or closed (`open` omitted: toggled). */
export const toggleDrawer = (openDrawers: readonly string[], path: string, open?: boolean): string[] => {
  const isOpen = openDrawers.includes(path);
  const next = open ?? !isOpen;
  if (next === isOpen) return [...openDrawers];
  return next ? [...openDrawers, path] : openDrawers.filter((other) => other !== path);
};

export type DeskKeyAction = { type: "focus"; index: number } | { type: "toggle"; path: string; open: boolean } | { type: "open"; binderId: string };

/** What a key does on row `index`, per the WAI-ARIA tree pattern; undefined when it does nothing there. */
export const deskKey = (rows: readonly DeskRow[], index: number, key: string): DeskKeyAction | undefined => {
  const row = rows[index];
  if (row === undefined) return undefined;
  const { node } = row;
  const action = treeKey(rows, index, key, node.kind === "drawer");
  if (action === undefined || action.type === "focus") return action;
  if (node.kind === "drawer") return { type: "toggle", path: node.path, open: action.type === "toggle" ? action.open : row.expanded !== true };
  if (action.type === "toggle") return undefined;
  return node.binder.id === null ? undefined : { type: "open", binderId: node.binder.id };
};

const items = (count: number): string => `${String(count)} ${count === 1 ? "item" : "items"}`;

const problemLabel = (problem: Problem): string => {
  const location = problemLocation(problem, SETTINGS_FILE);
  return location === undefined ? problem.message : `${problem.message} (${location})`;
};

/** A row's accessible name: its name first, then a binder's counts or a broken binder's problems. */
export const rowLabel = (node: DeskNode): string => {
  const name = nodeName(node);
  if (node.kind === "drawer") return name;
  const { binder } = node;
  if (binder.id === null) return [name, ...binder.problems.map(problemLabel)].join(", ");
  return [name, items(binder.itemCount), ...(binder.invalidCount > 0 ? [`${String(binder.invalidCount)} invalid`] : [])].join(", ");
};
