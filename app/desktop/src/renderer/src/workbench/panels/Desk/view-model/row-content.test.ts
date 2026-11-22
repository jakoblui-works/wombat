// What a list row shows: its excerpt in the title's place when the excerpt repeats the title (as read, Markdown
// markers aside, a cut title's "…" aside), else the title; in a tree or a view with `excerpt: false`, the title always.
// A board shows its rows as the list it is drawn as.
import { describe, expect, test } from "vitest";

import type { ItemSummary, LenientView } from "@wombat/shared/items";

import { rowContent } from "./row-content.ts";
import { PLAIN_LIST, sidebarView, type SidebarView } from "./view-model.ts";

const item = (title: string | null, excerpt: string | null): ItemSummary => ({
  id: "0196f3c2-0000-7000-8000-000000000001",
  handle: "BL-1",
  aliases: [],
  title,
  properties: { status: "doing" },
  path: "backlog/BL-1-invented.md",
  version: "0".repeat(64),
  problems: [],
  excerpt,
  binder: "backlog",
});

const BY_STATUS: SidebarView = { name: "By status", kind: "list", group: "status" };
const TITLES_ONLY: SidebarView = { name: "Titles", kind: "list", group: "status", excerpt: false };
const TREE: SidebarView = { name: "Tree", kind: "tree", parent: "parent" };
const BOARD: LenientView = { name: "Board", kind: "board", column: "status" };
const TITLES_ONLY_BOARD: LenientView = { name: "Board", kind: "board", column: "status", excerpt: false };

const TITLE = "Fix the login form";
const REPEATING = "**Fix the login form** when the session expires.";

describe("the text a wrapping row shows in its title's place", () => {
  test.each<{ what: string; title: string | null; excerpt: string | null; view: SidebarView; line: string | undefined }>([
    { what: "an excerpt repeating the title in bold", title: TITLE, excerpt: REPEATING, view: BY_STATUS, line: REPEATING },
    {
      what: "an excerpt continuing a title cut mid-word with …",
      title: "Fix the login form on sl…",
      excerpt: "Fix the login form on slow networks before the release.",
      view: BY_STATUS,
      line: "Fix the login form on slow networks before the release.",
    },
    {
      what: "an excerpt repeating a code-span title",
      title: "`pnpm test` fails offline",
      excerpt: "`pnpm test` fails offline since the cache moved.",
      view: PLAIN_LIST,
      line: "`pnpm test` fails offline since the cache moved.",
    },
    { what: "a different excerpt keeps the title", title: TITLE, excerpt: "Users are signed out after a minute.", view: BY_STATUS, line: undefined },
    { what: "no excerpt keeps the title", title: TITLE, excerpt: null, view: BY_STATUS, line: undefined },
    { what: "a board shows its rows as a list does", title: TITLE, excerpt: REPEATING, view: sidebarView(BOARD), line: REPEATING },
    { what: "a list with excerpt: false shows titles only", title: TITLE, excerpt: REPEATING, view: TITLES_ONLY, line: undefined },
    { what: "a board with excerpt: false shows titles only", title: TITLE, excerpt: REPEATING, view: sidebarView(TITLES_ONLY_BOARD), line: undefined },
    { what: "a tree shows titles only", title: TITLE, excerpt: REPEATING, view: TREE, line: undefined },
  ])("$what", ({ title, excerpt, view, line }) => {
    expect(rowContent(item(title, excerpt), view)).toBe(line);
  });
});
