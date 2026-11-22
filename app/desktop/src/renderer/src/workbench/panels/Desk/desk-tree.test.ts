// The Desk's tree: the drawers are exactly the folders on the way to a binder, a binder sits under the folder it is
// in (another binder's, or a drawer), folders that only share a prefix stay apart, and siblings sort as a person
// reads them.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { BinderSummary } from "@wombat/shared/items";

import { type DeskNode, deskTree, nodeName } from "./desk-tree.ts";

const listing = (path: string) => ({ path, itemCount: 0, invalidCount: 0, problems: [] });

const binder = (path: string, name = `Binder at ${path}`): BinderSummary => ({
  id: `binder-${path}`,
  name,
  prefix: "BX",
  access: "edit",
  naming: "handle",
  instructions: "off",
  properties: {},
  views: [],
  ...listing(path),
});

const broken = (path: string): BinderSummary => ({ id: null, ...listing(path), problems: [{ message: "The settings don't parse." }] });

/** The folders above a path, outermost first ("a/b/c" → "a", "a/b"); the items root "." has none. */
const foldersAbove = (path: string): string[] => {
  if (path === ".") return [];
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
};

/** Each node with the folder paths of the nodes above it, outermost first; "." for a binder at the items root. */
const placed = (nodes: readonly DeskNode[], above: string[] = []): { node: DeskNode; path: string; above: string[] }[] =>
  nodes.flatMap((node) => {
    const path = node.kind === "drawer" ? node.path : node.binder.path;
    return [{ node, path, above }, ...placed(node.children, [...above, path])];
  });

const label = (node: DeskNode) => (node.kind === "drawer" ? `drawer ${node.path}` : `binder ${node.binder.path}`);

/** The tree as labels, children nested, for the named cases. */
const shape = (nodes: readonly DeskNode[]): unknown[] =>
  nodes.map((node) => (node.children.length === 0 ? label(node) : { [label(node)]: shape(node.children) }));

describe("deskTree", () => {
  // Segments that share prefixes and differ only in case or digits.
  const segment = fc.constantFrom("a", "ab", "A", "b9", "b10", "work");
  const folder = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"));
  const binders = fc
    .tuple(fc.uniqueArray(fc.tuple(folder, fc.boolean()), { selector: ([path]) => path, maxLength: 8 }), fc.boolean())
    .map(([paths, atRoot]) => [
      ...(atRoot ? [binder(".")] : []),
      ...paths.map(([path, isBroken]) => (isBroken ? broken(path) : binder(path))),
    ]);

  test("every binder appears once, under exactly the folders above it; the drawers are exactly the folders leading to a binder", () => {
    fc.assert(
      fc.property(binders, (list) => {
        const rows = placed(deskTree(list));
        const binderPaths = list.map((one) => one.path);
        const shown = rows.filter(({ node }) => node.kind === "binder").map(({ path }) => path);
        expect(shown.toSorted()).toEqual(binderPaths.toSorted());

        const rootBinder = binderPaths.includes(".") ? ["."] : [];
        for (const { node, path, above } of rows) {
          if (path === ".") expect(above, "the items root's binder is at the top").toEqual([]);
          else expect(above, `what ${label(node)} sits under`).toEqual([...rootBinder, ...foldersAbove(path)]);
        }

        const leading = new Set(binderPaths.flatMap(foldersAbove).filter((path) => !binderPaths.includes(path)));
        const drawers = rows.filter(({ node }) => node.kind === "drawer").map(({ path }) => path);
        expect(drawers.toSorted()).toEqual([...leading].toSorted());
      }),
    );
  });

  test.each([
    {
      what: "folders that share a prefix stay siblings",
      binders: [binder("work/a"), binder("work/ab")],
      tree: [{ "drawer work": ["binder work/a", "binder work/ab"] }],
    },
    {
      what: "a binder inside a binder nests under it",
      binders: [binder("team/bugs/archive"), binder("team")],
      tree: [{ "binder team": [{ "drawer team/bugs": ["binder team/bugs/archive"] }] }],
    },
    {
      what: "a binder at the items root holds everything else",
      binders: [binder("notes"), binder(".")],
      tree: [{ "binder .": ["binder notes"] }],
    },
    {
      what: "a broken binder still holds the binders in its folder",
      binders: [broken("team"), binder("team/bugs")],
      tree: [{ "binder team": ["binder team/bugs"] }],
    },
  ])("$what", ({ binders: list, tree }) => {
    expect(shape(deskTree(list))).toEqual(tree);
  });

  test("siblings sort as a person reads them: case aside, numbers by value, drawers and binders mixed", () => {
    const tree = deskTree([binder("x1", "b10"), binder("x2", "B9"), binder("a/inner"), binder("x3", "Ab")]);
    expect(tree.map(nodeName)).toEqual(["a", "Ab", "B9", "b10"]);
  });
});
