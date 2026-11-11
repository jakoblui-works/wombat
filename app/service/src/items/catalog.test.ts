import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, onTestFinished } from "vitest";

import { findByHandle, openCatalog } from "./catalog.ts";
import { DOCS_SETTINGS, IDS, VALID_FILES, handleNumber, itemAt, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

const UNASSIGNED = "---\nproject: wombat\n---\n# Typed by hand\n";

describe("next handle number", () => {
  test("one above the highest handle or alias on disk when the store's counter is lower", async () => {
    // BL-1 has the alias BL-3, the highest number on disk.
    const { catalog } = openItems(writeRoot({ ...VALID_FILES, "backlog/typed.md": UNASSIGNED }));

    const item = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "backlog"), "backlog/typed.md");

    expect(item.handle).toBe("BL-4");
  });

  test("one above the store's counter when it is higher than anything on disk", async () => {
    const opened = openItems(writeRoot({ ...VALID_FILES, "backlog/typed.md": UNASSIGNED }));
    for (let given = 0; given < 9; given += 1) opened.store.nextHandleNumber("backlog", 0);

    const item = itemAt((await opened.catalog.snapshot()).items.filter((item) => item.structure === "backlog"), "backlog/typed.md");

    expect(handleNumber(item.handle)).toBe(10);
    expect(opened.store.nextHandleNumber("backlog", 0)).toBe(11);
  });
});

describe("structure problems", () => {
  const structure = (id: string, prefix: string, extra = "") => `version: 1\nid: ${id}\nname: ${id}\nprefix: ${prefix}\naccess: edit\n${extra}`;

  test("a duplicate structure id or prefix is a problem of both structures, whose files aren't written", async () => {
    const root = writeRoot({
      ...VALID_FILES,
      "old-bugs/_structure.yaml": structure("bugs", "OLD"),
      "old-bugs/typed.md": "# Typed by hand\n",
      "ideas/_structure.yaml": structure("ideas", "BL"),
    });
    const { catalog } = openItems(root);

    const structures = (await catalog.snapshot()).structures;

    const at = (path: string) => structures.find((loaded) => loaded.path === path);
    expect(at("bugs")?.problems.map((problem) => problem.field)).toEqual(["id"]);
    expect(at("old-bugs")?.problems.map((problem) => problem.field)).toEqual(["id"]);
    expect(at("backlog")?.problems.map((problem) => problem.field)).toEqual(["prefix"]);
    expect(at("ideas")?.problems.map((problem) => problem.field)).toEqual(["prefix"]);
    expect(readAt(root, "old-bugs/typed.md")).toBe("# Typed by hand\n");
    // The docs at the root are unaffected.
    expect(at("")?.problems).toEqual([]);
    expect((await catalog.snapshot()).items.filter((item) => item.structure === "docs").map((item) => item.problems)).toEqual([[], []]);
  });

  test("a link to an unknown structure names the property's `to`", async () => {
    const root = writeRoot({ ...VALID_FILES, "tasks/_structure.yaml": structure("tasks", "TSK", "properties:\n  epic: { type: link, to: epics }\n") });
    const { catalog } = openItems(root);

    const tasks = (await catalog.snapshot()).structures.find((loaded) => loaded.id === "tasks");

    expect(tasks?.problems).toEqual([expect.objectContaining({ field: "properties.epic.to" })]);
    expect(tasks?.problems[0]?.message).toContain("epics");
  });

  test("settings failing the schema are listed with id null, the zod path and message as written, while the others load", async () => {
    const root = writeRoot({
      ...VALID_FILES,
      "tasks/_structure.yaml": structure("tasks", "TSK", "properties:\n  size: { type: select }\n"),
      "tasks/TSK-1.md": "# Never loaded\n",
    });
    const { catalog } = openItems(root);

    const { structures, items } = await catalog.snapshot();

    const tasks = structures.find((loaded) => loaded.path === "tasks");
    expect(tasks?.id).toBeNull();
    expect(tasks?.problems.map(({ field, line }) => ({ field, line }))).toEqual([{ field: "properties.size.options", line: 7 }]);
    expect(tasks?.problems[0]?.message).toMatch(/^options\b/);
    expect(items.some((item) => item.path.startsWith("tasks/"))).toBe(false);
    expect(readAt(root, "tasks/TSK-1.md")).toBe("# Never loaded\n");
    expect(structures.filter((loaded) => loaded.id !== null).map((loaded) => loaded.id).sort()).toEqual(["backlog", "bugs", "docs"]);
    expect(itemAt(items, "bugs/BUG-1-login-times-out.md").problems).toEqual([]);
  });
});

describe("resolve", () => {
  test("finds an item by its handle and by an alias; an unknown handle is undefined", async () => {
    const { catalog } = openItems(writeRoot(VALID_FILES));

    expect(findByHandle((await catalog.snapshot()).items, "BL-1")?.id).toBe(IDS.bl1);
    expect(findByHandle((await catalog.snapshot()).items, "BL-3")?.id).toBe(IDS.bl1);
    expect(findByHandle((await catalog.snapshot()).items, "BL-99")).toBeUndefined();
  });
});

describe("free structure membership", () => {
  test("an include match through a symlink out of the structure's folder is neither listed nor written", async () => {
    const outside = mkdtempSync(join(tmpdir(), "wombat-outside-"));
    onTestFinished(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, "secret.md"), "# Outside the items root\n");
    const root = writeRoot({ "_structure.yaml": DOCS_SETTINGS, "architecture.md": "# Architecture\n" });
    symlinkSync(outside, join(root, "guides"));

    const docs = (await openItems(root).catalog.snapshot()).items.filter((item) => item.structure === "docs");

    expect(docs.map((item) => item.path)).toEqual(["architecture.md"]);
    expect(readAt(outside, "secret.md")).toBe("# Outside the items root\n");
  });
});

describe("free structure membership through a symlinked folder", () => {
  test("a file named by an include path through a symlinked folder is listed once, by its real folder", async () => {
    const root = writeRoot({
      ...VALID_FILES,
      "_structure.yaml": DOCS_SETTINGS.replace('include: ["architecture.md", "guides/*.md"]', 'include: ["architecture.md", "guides/setup.md", "manuals/setup.md"]'),
    });
    symlinkSync(join(root, "guides"), join(root, "manuals"));

    const docs = (await openItems(root).catalog.snapshot()).items.filter((item) => item.structure === "docs");

    expect(docs.map((item) => [item.path, item.problems])).toEqual([
      ["architecture.md", []],
      ["guides/setup.md", []],
    ]);
  });
});

describe("links rewritten on first sight", () => {
  test.each([
    { what: "an id shared with another item", id: IDS.bl1 },
    { what: "an id that isn't a UUID", id: "bl-two" },
  ])("a handle naming a target with $what is left as typed, and the item is invalid", async ({ id }) => {
    const linking = "---\nid: 0196f3c2-7a00-7000-8000-000000000001\nhandle: BUG-5\nrepo: api\nblocks: BL-2\n---\n# Linked by handle\n";
    const root = writeRoot({
      ...VALID_FILES,
      "backlog/BL-2-proposal-view.md": (VALID_FILES["backlog/BL-2-proposal-view.md"] ?? "").replace(IDS.bl2, id),
      "bugs/BUG-5-linked.md": linking,
    });

    const item = itemAt((await openItems(root).catalog.snapshot()).items.filter((item) => item.structure === "bugs"), "bugs/BUG-5-linked.md");

    expect(readAt(root, "bugs/BUG-5-linked.md")).toBe(linking);
    expect(item.problems.map((problem) => problem.field)).toEqual(["blocks"]);
    expect(item.problems[0]?.message).toContain("BL-2 has no valid id yet");
  });
});

// Permissions don't bind root, so these only run as a normal user.
describe.skipIf(process.getuid?.() === 0)("folders the service can't use", () => {
  test("a first-sight write refused by the file system shows as a problem and isn't retried within the read", async () => {
    const root = writeRoot({ ...VALID_FILES, "backlog/typed.md": UNASSIGNED });
    const events: string[] = [];
    const catalog = openCatalog({ root, store: openItems(root).store, log: (event) => events.push(event) });
    chmodSync(join(root, "backlog"), 0o555);
    try {
      const item = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "backlog"), "backlog/typed.md");

      expect(item.id).toBeNull();
      expect(item.problems.map((problem) => problem.field)).toEqual(["id"]);
      expect(item.problems[0]?.message).toContain("EACCES");
      expect(events.filter((event) => event === "item_first_sight_failed")).toHaveLength(1);
      expect(readAt(root, "backlog/typed.md")).toBe(UNASSIGNED);
    } finally {
      chmodSync(join(root, "backlog"), 0o755);
    }
  });

  test("an unreadable folder is a problem of its structure, and the other structures still list", async () => {
    const root = writeRoot(VALID_FILES);
    mkdirSync(join(root, "bugs", "private"));
    chmodSync(join(root, "bugs", "private"), 0o000);
    try {
      const { structures, items } = await openItems(root).catalog.snapshot();

      const bugs = structures.find((structure) => structure.id === "bugs");
      expect(bugs?.problems).toHaveLength(1);
      expect(bugs?.problems[0]?.message).toContain("bugs/private");
      expect(items.filter((item) => item.structure === "backlog").map((item) => item.handle)).toEqual(["BL-1", "BL-2"]);
    } finally {
      chmodSync(join(root, "bugs", "private"), 0o755);
    }
  });
});
