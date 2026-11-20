// What an item's card shows: the chips a view's `show` names, or else every property with a value but the one the
// view is laid out by; and the body's excerpt on a list's cards, unless the view hides it or it repeats the title.
import { expect, test } from "vitest";

import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { cardContent } from "./card-content.ts";
import type { SidebarView } from "./view-model.ts";

const PROPERTIES: Record<string, LenientProperty> = {
  repo: { type: "select", options: ["api", "site-web"], required: false },
  stage: { type: "select", options: ["todo", "doing", "done"], required: false },
  effort: { type: "number", required: false },
  parent: { type: "link", to: "backlog", required: false },
  note: { type: "text", required: false },
};
/** Every property but `note` has a value. */
const VALUES: Record<string, unknown> = {
  repo: "api",
  stage: "doing",
  effort: 3,
  parent: { id: "0196f3c2-0000-7000-8000-000000000009", handle: "BL-9" },
  note: "",
};
const WITH_VALUE = Object.keys(PROPERTIES).filter((name) => name !== "note");

const EXCERPT = "Something the body says first.";

const item = (fields: Partial<ItemSummary> = {}): ItemSummary => ({
  id: "0196f3c2-0000-7000-8000-000000000001",
  handle: "BL-1",
  aliases: [],
  title: "Invented item one",
  properties: VALUES,
  path: "backlog/BL-1-invented.md",
  version: "0".repeat(64),
  problems: [],
  excerpt: EXCERPT,
  binder: "backlog",
  ...fields,
});

/** The view key naming the property each kind lays its items out by. */
const LAYOUT_KEY = { list: "group", tree: "parent" } as const;
const layoutProperty = (view: SidebarView): unknown => (view as Record<string, unknown>)[LAYOUT_KEY[view.kind]];

const list: SidebarView = { name: "Open", kind: "list", group: "repo" };
const tree: SidebarView = { name: "Tree", kind: "tree", parent: "parent" };

// [case, view, item, the chips' names (undefined: every property with a value but the layout one), the excerpt shown]
const cases: [string, SidebarView, ItemSummary, string[] | undefined, string | undefined][] = [
  ["a list grouped by a property", list, item(), undefined, EXCERPT],
  ["a list without a group", { name: "All", kind: "list" }, item(), undefined, EXCERPT],
  ["a tree", tree, item(), undefined, undefined],
  ["show names chips in its order, empty ones dropped", { ...list, show: ["effort", "note", "stage", "repo"] }, item(), ["effort", "stage", "repo"], EXCERPT],
  ["show of no properties", { ...list, show: [] }, item(), [], EXCERPT],
  ["excerpt: false", { ...list, excerpt: false }, item(), undefined, undefined],
  ["no excerpt", list, item({ excerpt: null }), undefined, undefined],
  ["an excerpt repeating the title", list, item({ title: "Fix  the login\npage", excerpt: "Fix the login page when the session ends." }), undefined, undefined],
  ["an excerpt repeating a cut title", list, item({ title: "Fix the login…", excerpt: "Fix the login page when the session ends." }), undefined, undefined],
  ["an excerpt only sharing words with the title", list, item({ title: "Login page", excerpt: "The login page fails." }), undefined, "The login page fails."],
];

test.each(cases)("a card: %s", (_case, view, one, show, excerpt) => {
  const content = cardContent(one, view, PROPERTIES);
  const expected = show ?? WITH_VALUE.filter((name) => name !== layoutProperty(view));
  expect(content.chips.map(({ name }) => name)).toEqual(expected);
  expect(content.excerpt).toBe(excerpt);
});
