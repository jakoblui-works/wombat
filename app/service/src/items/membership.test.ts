// Which files belong to which structure. An item counted in the wrong
// structure gets that structure's access level for agents (a hidden child's file readable through its
// parent), with nothing showing it. Items are the .md files directly in a structure's folder, or a free
// structure's `include` matches; never a file inside another structure's folder; dot folders and node_modules
// are never scanned; a file outside every structure is left alone.
import { describe, expect, test } from "vitest";

import { BACKLOG_SETTINGS, BUGS_SETTINGS, DOCS_SETTINGS, openItems, writeRoot } from "../../test/items-fixtures.ts";

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
  "_structure.yaml": DOCS_SETTINGS,
  "architecture.md": item("DOC-1", "Architecture"),
  "guides/setup.md": item("DOC-2", "Setup"),
  "guides/old/v1-setup.md": item("DOC-3", "Old setup, two levels down"),
  "roadmap.md": "# Roadmap\n\nNot included by Docs.\n",
  "bugs/_structure.yaml": BUGS_SETTINGS,
  "bugs/BUG-1-open.md": item("BUG-1", "An open bug", "repo: api\n"),
  "bugs/notes/triage.md": "# Triage notes\n\nIn a plain subfolder of Bugs.\n",
  "bugs/archive/_structure.yaml": ARCHIVE_SETTINGS,
  "bugs/archive/ARC-1-old.md": item("ARC-1", "An archived bug"),
  "backlog/_structure.yaml": BACKLOG_SETTINGS,
  "backlog/BL-1-idea.md": item("BL-1", "An idea"),
  "guides/notes.txt": "Not markdown, so never an item.\n",
  ".drafts/_structure.yaml": "version: 1\nid: drafts\nname: Drafts\nprefix: DRF\naccess: edit\n",
  ".drafts/DRF-1.md": item("DRF-1", "In a dot folder"),
  "node_modules/some-pkg/_structure.yaml": "version: 1\nid: vendored\nname: Vendored\nprefix: VND\naccess: edit\n",
  "node_modules/some-pkg/VND-1.md": item("VND-1", "In node_modules"),
};

describe("membership", () => {
  test("each structure lists exactly its own files, a nested structure's files only in the nested one", async () => {
    const root = writeRoot(FILES);
    const { catalog } = openItems(root);

    const structures = (await catalog.snapshot()).structures;
    expect(structures.map((structure) => structure.id).sort()).toEqual(["archive", "backlog", "bugs", "docs"]);

    const listed: Record<string, string[]> = {};
    for (const id of ["docs", "bugs", "archive", "backlog"]) {
      listed[id] = ((await catalog.snapshot()).items.filter((item) => item.structure === id)).map((loaded) => loaded.handle ?? loaded.path).sort();
    }
    expect(listed).toEqual({
      docs: ["DOC-1", "DOC-2"],
      bugs: ["BUG-1"],
      archive: ["ARC-1"],
      backlog: ["BL-1"],
    });
  });

  test("a free structure's include never takes a file from another structure's folder", async () => {
    const root = writeRoot({
      ...FILES,
      "_structure.yaml": DOCS_SETTINGS.replace('include: ["architecture.md", "guides/*.md"]', 'include: ["architecture.md", "guides/*.md", "bugs/*.md"]'),
    });
    const { catalog } = openItems(root);

    const docs = ((await catalog.snapshot()).items.filter((item) => item.structure === "docs")).map((loaded) => loaded.handle);
    const bugs = ((await catalog.snapshot()).items.filter((item) => item.structure === "bugs")).map((loaded) => loaded.handle);

    expect(docs).not.toContain("BUG-1");
    expect(bugs).toEqual(["BUG-1"]);
  });

  test("a nested structure whose settings are broken keeps its files: a free parent including every .md never lists them", async () => {
    const root = writeRoot({
      "_structure.yaml": DOCS_SETTINGS.replace('include: ["architecture.md", "guides/*.md"]', 'include: ["**/*.md"]'),
      "architecture.md": item("DOC-1", "Architecture"),
      // Meant to be hidden; the typo makes its settings invalid.
      "vault/_structure.yaml": ARCHIVE_SETTINGS.replace("access: hidden", "acess: hidden"),
      "vault/ARC-1-plan.md": item("ARC-1", "A plan nobody else should read"),
    });
    const { catalog } = openItems(root);

    const docs = (await catalog.snapshot()).items.filter((loaded) => loaded.structure === "docs").map((loaded) => loaded.path);

    expect(docs).toEqual(["architecture.md"]);
  });
});
