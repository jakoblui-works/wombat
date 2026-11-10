// The writer's file names and the writes it refuses: files it creates are named by handle and title, a free
// structure's file is checked like a hand-made one, and a write that wouldn't validate leaves the file as it was.
import { existsSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ItemWriteError } from "./write.ts";
import { BUGS_SETTINGS, IDS, VALID_FILES, expectWriteError, itemAt, mdFilesIn, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

const BUG_FILE = "bugs/BUG-1-login-times-out.md";

describe("created files", () => {
  test("a handle-named structure names the file BUG-n-<slug>, the slug ASCII words of the title", async () => {
    const root = writeRoot(VALID_FILES);
    const { writer } = openItems(root);

    const item = await writer.createItem("bugs", { title: "Café menu: prices DON'T load", body: "\nSeen once.\n", properties: { repo: "api" } });

    expect(item.handle).toBe("BUG-3");
    expect(item.path).toBe("bugs/BUG-3-cafe-menu-prices-don-t-load.md");
    expect(existsSync(join(root, item.path))).toBe(true);
  });

  test("the slug stops at a word within 50 characters", async () => {
    const root = writeRoot(VALID_FILES);
    const { writer } = openItems(root);
    const title = "The dashboard chart legend overlaps the axis labels when the window is narrow";

    const item = await writer.createItem("bugs", { title, body: "", properties: { repo: "site-web" } });

    const slug = item.path.replace(/^bugs\/BUG-3-/, "").replace(/\.md$/, "");
    expect(slug).toBe("the-dashboard-chart-legend-overlaps-the-axis");
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  test("a free structure creates the file it's given", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);

    const item = await writer.createItem("docs", { title: "Deploying", body: "\nPush to main.\n", properties: {}, file: "guides/deploying.md" });

    expect(item.path).toBe("guides/deploying.md");
    expect(itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "docs"), "guides/deploying.md").problems).toEqual([]);
  });

  test.each([
    { what: "no file", file: undefined },
    { what: "an absolute path", file: "/tmp/deploying.md" },
    { what: "an existing file", file: "guides/setup.md" },
    { what: "a path outside include", file: "deploying.md" },
    { what: "a file that isn't markdown", file: "guides/deploying.txt" },
  ])("a free structure refuses $what and writes nothing", async ({ file }) => {
    const root = writeRoot(VALID_FILES);
    const { writer } = openItems(root);
    const before = { root: mdFilesIn(root, ""), guides: mdFilesIn(root, "guides"), bugs: mdFilesIn(root, "bugs") };

    await expectWriteError(writer.createItem("docs", { title: "Deploying", body: "", properties: {}, ...(file === undefined ? {} : { file }) }), "invalid_fields", String(file));

    expect({ root: mdFilesIn(root, ""), guides: mdFilesIn(root, "guides"), bugs: mdFilesIn(root, "bugs") }).toEqual(before);
    expect(readAt(root, "guides/setup.md")).toBe(VALID_FILES["guides/setup.md"]);
  });

  test.each([
    { what: "a path with ..", file: "notes/../deploying.md", says: '".."' },
    { what: "a path in another structure's folder", file: "bugs/deploying.md", says: "another structure's folder" },
  ])("a free structure including every .md refuses $what", async ({ file, says }) => {
    const root = writeRoot({
      "_structure.yaml": 'version: 1\nid: notes\nname: Notes\nprefix: NOTE\naccess: edit\nnaming: free\ninclude: ["**/*.md"]\n',
      "notes/.keep": "",
      "bugs/_structure.yaml": BUGS_SETTINGS,
    });
    const { writer } = openItems(root);

    const refused = await writer.createItem("notes", { title: "Deploying", body: "", properties: {}, file }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((refused as ItemWriteError).code).toBe("invalid_fields");
    expect((refused as ItemWriteError).problems.map((problem) => problem.message).join("\n")).toContain(says);
    expect(mdFilesIn(root, "").concat(mdFilesIn(root, "bugs"))).toEqual([]);
  });

  test("a free structure refuses a path through a symlinked folder", async () => {
    const root = writeRoot(VALID_FILES);
    mkdirSync(join(root, "elsewhere"));
    renameSync(join(root, "guides"), join(root, "elsewhere/guides"));
    symlinkSync(join(root, "elsewhere/guides"), join(root, "guides"));
    const { writer } = openItems(root);

    await expectWriteError(writer.createItem("docs", { title: "Deploying", body: "", properties: {}, file: "guides/deploying.md" }), "invalid_fields", "symlink");

    expect(existsSync(join(root, "elsewhere/guides/deploying.md"))).toBe(false);
  });
});

describe("invalid writes", () => {
  test.each([
    { what: "an unknown field", fields: { severity: "high" }, names: "severity" },
    { what: "a value that isn't an option", fields: { repo: "mobile" }, names: "repo" },
  ])("an update with $what is refused, naming it, and the file is unchanged", async ({ fields, names }) => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    const refused = await writer.updateItem("BUG-1", fields, version).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(ItemWriteError);
    expect((refused as ItemWriteError).code).toBe("invalid_fields");
    expect((refused as ItemWriteError).problems.map((problem) => problem.field)).toContain(names);
    expect(readAt(root, BUG_FILE)).toBe(VALID_FILES[BUG_FILE]);
  });

  test("a create without a required property is refused and creates no file", async () => {
    const root = writeRoot(VALID_FILES);
    const { writer } = openItems(root);

    await expectWriteError(writer.createItem("bugs", { title: "No repo given", body: "", properties: {} }), "invalid_fields");

    expect(mdFilesIn(root, "bugs").sort()).toEqual(["BUG-1-login-times-out.md", "hero-caption.md"]);
  });
});

describe("property values", () => {
  test("a handle or alias given in a link field is stored as the target's id, on update and on create", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    await writer.updateItem("BUG-1", { blocks: "BL-2" }, version);
    const created = await writer.createItem("bugs", { title: "Blocked by an alias", body: "", properties: { repo: "api", blocks: "BL-3" } });

    expect(readAt(root, BUG_FILE)).toBe((VALID_FILES[BUG_FILE] ?? "").replace(`blocks: ${IDS.bl1}\n`, `blocks: ${IDS.bl2}\n`));
    expect(readAt(root, created.path)).toContain(`\nblocks: ${IDS.bl1}\n`);
  });

  test("null removes a property's line and keeps every other byte", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    await writer.updateItem("BUG-1", { note: null }, version);

    expect(readAt(root, BUG_FILE)).toBe((VALID_FILES[BUG_FILE] ?? "").replace("note: Seen after the session cookie change\n", ""));
  });

  test("null on a required property is refused and the file is unchanged", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    await expectWriteError(writer.updateItem("BUG-1", { repo: null }, version), "invalid_fields");

    expect(readAt(root, BUG_FILE)).toBe(VALID_FILES[BUG_FILE]);
  });

  test("updating a block-scalar value keeps the key on the next line", async () => {
    const original = (VALID_FILES[BUG_FILE] ?? "").replace("note: Seen after the session cookie change\n", "note: |\n  Seen twice,\n  both on staging.\n");
    const root = writeRoot({ ...VALID_FILES, [BUG_FILE]: original });
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    await writer.updateItem("BUG-1", { note: "Seen once" }, version);

    expect(readAt(root, BUG_FILE)).toBe(original.replace("note: |\n  Seen twice,\n  both on staging.\n", "note: Seen once\n"));
  });

  test("updating a block-scalar value that is the last key of a CRLF file keeps the closing fence", async () => {
    const original = (VALID_FILES[BUG_FILE] ?? "")
      .replace("note: Seen after the session cookie change\n", "")
      .replace(`blocks: ${IDS.bl1}\n`, `blocks: ${IDS.bl1}\nnote: |\n  Seen twice,\n  both on staging.\n`)
      .replaceAll("\n", "\r\n");
    const root = writeRoot({ ...VALID_FILES, [BUG_FILE]: original });
    const { catalog, writer } = openItems(root);
    const { version } = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), BUG_FILE);

    await writer.updateItem("BUG-1", { note: "Seen once" }, version);

    expect(readAt(root, BUG_FILE)).toBe(original.replace("note: |\r\n  Seen twice,\r\n  both on staging.\r\n", "note: Seen once\r\n"));
  });
});
