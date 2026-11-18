// Which files belong to which binder. An item counted in the wrong
// binder gets that binder's access level for agents (a hidden child's file readable through its
// parent), with nothing showing it. Items are the .md files directly in a binder's folder, or a free
// binder's `include` matches; never a file inside another binder's folder; dot folders and node_modules
// are never scanned; a file outside every binder is left alone.
import type { Problem } from "@wombat/shared/items";
import { describe, expect, test } from "vitest";

import { BACKLOG_SETTINGS, BUGS_SETTINGS, DOCS_SETTINGS, isOldSettingsProblem, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";
import { OLD_SETTINGS_FILE, SETTINGS_FILE } from "./binders.ts";

let serial = 0;
/** A valid item file with an id of its own. */
const item = (handle: string, title: string, frontmatter = "") => {
  serial += 1;
  const id = `0196f3c2-6f00-7000-8000-${String(serial).padStart(12, "0")}`;
  return `---\nid: ${id}\nhandle: ${handle}\n${frontmatter}---\n# ${title}\n`;
};

const ARCHIVE_SETTINGS = `version: 1
id: archive
name: Archived bugs
prefix: ARC
access: hidden
`;

const FILES: Record<string, string> = {
  [SETTINGS_FILE]: DOCS_SETTINGS,
  "architecture.md": item("DOC-1", "Architecture"),
  "guides/setup.md": item("DOC-2", "Setup"),
  "guides/old/v1-setup.md": item("DOC-3", "Old setup, two levels down"),
  "roadmap.md": "# Roadmap\n\nNot included by Docs.\n",
  [`bugs/${SETTINGS_FILE}`]: BUGS_SETTINGS,
  "bugs/BUG-1-open.md": item("BUG-1", "An open bug", "repo: api\n"),
  "bugs/notes/triage.md": "# Triage notes\n\nIn a plain subfolder of Bugs.\n",
  [`bugs/archive/${SETTINGS_FILE}`]: ARCHIVE_SETTINGS,
  "bugs/archive/ARC-1-old.md": item("ARC-1", "An archived bug"),
  [`backlog/${SETTINGS_FILE}`]: BACKLOG_SETTINGS,
  "backlog/BL-1-idea.md": item("BL-1", "An idea"),
  "guides/notes.txt": "Not markdown, so never an item.\n",
  [`.drafts/${SETTINGS_FILE}`]: "version: 1\nid: drafts\nname: Drafts\nprefix: DRF\naccess: edit\n",
  ".drafts/DRF-1.md": item("DRF-1", "In a dot folder"),
  [`node_modules/some-pkg/${SETTINGS_FILE}`]: "version: 1\nid: vendored\nname: Vendored\nprefix: VND\naccess: edit\n",
  "node_modules/some-pkg/VND-1.md": item("VND-1", "In node_modules"),
};

describe("membership", () => {
  test("each binder lists exactly its own files, a nested binder's files only in the nested one", async () => {
    const root = writeRoot(FILES);
    const { catalog } = openItems(root);

    const binders = (await catalog.snapshot()).binders;
    expect(binders.map((binder) => binder.id).sort()).toEqual(["archive", "backlog", "bugs", "docs"]);

    const listed: Record<string, string[]> = {};
    for (const id of ["docs", "bugs", "archive", "backlog"]) {
      listed[id] = ((await catalog.snapshot()).items.filter((item) => item.binder === id)).map((loaded) => loaded.handle ?? loaded.path).sort();
    }
    expect(listed).toEqual({
      docs: ["DOC-1", "DOC-2"],
      bugs: ["BUG-1"],
      archive: ["ARC-1"],
      backlog: ["BL-1"],
    });
  });

  test("a free binder's include never takes a file from another binder's folder", async () => {
    const root = writeRoot({
      ...FILES,
      [SETTINGS_FILE]: DOCS_SETTINGS.replace('include: ["architecture.md", "guides/*.md"]', 'include: ["architecture.md", "guides/*.md", "bugs/*.md"]'),
    });
    const { catalog } = openItems(root);

    const docs = ((await catalog.snapshot()).items.filter((item) => item.binder === "docs")).map((loaded) => loaded.handle);
    const bugs = ((await catalog.snapshot()).items.filter((item) => item.binder === "bugs")).map((loaded) => loaded.handle);

    expect(docs).not.toContain("BUG-1");
    expect(bugs).toEqual(["BUG-1"]);
  });

  test.each([
    {
      what: "whose settings are broken",
      // Meant to be hidden; the typo makes its settings invalid.
      settings: { [`vault/${SETTINGS_FILE}`]: ARCHIVE_SETTINGS.replace("access: hidden", "acess: hidden") },
      problem: (problem: Problem) => problem.field !== undefined,
    },
    {
      what: "holding only the old settings file",
      settings: { [`vault/${OLD_SETTINGS_FILE}`]: ARCHIVE_SETTINGS },
      problem: (problem: Problem) => isOldSettingsProblem(problem, "rename"),
    },
  ])("a nested binder $what is listed with id null and keeps its files: a free parent including every .md never lists them", async ({ settings, problem }) => {
    const typed = "# Typed by hand\n";
    const root = writeRoot({
      [SETTINGS_FILE]: DOCS_SETTINGS.replace('include: ["architecture.md", "guides/*.md"]', 'include: ["**/*.md"]'),
      "architecture.md": item("DOC-1", "Architecture"),
      ...settings,
      "vault/ARC-1-plan.md": item("ARC-1", "A plan nobody else should read"),
      "vault/typed.md": typed,
    });
    const { catalog } = openItems(root);

    const { binders, items } = await catalog.snapshot();

    expect(items.filter((loaded) => loaded.binder === "docs").map((loaded) => loaded.path)).toEqual(["architecture.md"]);
    const vault = binders.filter((binder) => binder.path === "vault");
    expect(vault.map((binder) => binder.id), "the nested folder is listed once, unloaded").toEqual([null]);
    expect(vault[0]?.problems.some(problem), JSON.stringify(vault[0]?.problems)).toBe(true);
    expect(readAt(root, "vault/typed.md"), "no id or handle written into its files").toBe(typed);
  });
});
