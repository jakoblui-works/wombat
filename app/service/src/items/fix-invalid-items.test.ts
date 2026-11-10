// Lasting check (silent failure): which invalid items the writer may change. An item whose only problems are
// property values can be updated (to fix them, or another field) as long as no field that was fine gets a problem;
// an item with an identity problem (duplicate handle or id, no title, unparseable) is never updated; a delete needs
// a file that parses and a handle no other file has, whichever of the files' versions is sent, through the writer and
// through an agent's edit path. A malformed handle or alias is the item's own problem, not a clash: its version is
// checked like any item's, an update is refused on that field, and a delete goes through. Otherwise a write could land on the wrong one of two files
// sharing a handle, or a bad item could never be fixed through the tools.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ItemWriteError } from "./write.ts";
import { ACCESS_FILES, AGENT, HIDDEN, MARKER, expectRefused, leaks, openAccessRoot, refusal, snapshotFiles } from "../../test/access-fixtures.ts";
import { BACKLOG_SETTINGS, BUGS_SETTINGS, FIXTURE_FILES, expectWriteError, itemAt, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

const versionOf = async (opened: ReturnType<typeof openItems>, file: string) => itemAt((await opened.catalog.snapshot()).items.filter((item) => item.structure === "bugs"), file).version;

const refused = async (call: Promise<unknown>, what: string) => {
  let error: unknown;
  try {
    await call;
  } catch (thrown) {
    error = thrown;
  }
  expect(error, `${what}: refused with an ItemWriteError`).toBeInstanceOf(ItemWriteError);
};

describe("changing invalid items", () => {
  test("an item with only value problems can be fixed, or changed elsewhere, but not given a new problem", async () => {
    const root = writeRoot(FIXTURE_FILES);
    const opened = openItems(root);
    const unknownOption = "bugs/BUG-13-unknown-repo.md";
    const missingRequired = "bugs/BUG-12-missing-repo.md";

    // Another field changes; the existing value problem stays and nothing new appears.
    await opened.writer.updateItem("BUG-13", { note: "Seen on the mobile build" }, await versionOf(opened, unknownOption));
    expect(itemAt((await opened.catalog.snapshot()).items.filter((item) => item.structure === "bugs"), unknownOption).properties.note).toBe("Seen on the mobile build");

    // A field that was fine gets a problem: refused, file unchanged.
    const before = readAt(root, unknownOption);
    await expectWriteError(opened.writer.updateItem("BUG-13", { order: "soon" }, await versionOf(opened, unknownOption)), "invalid_fields", "order");
    expect(readAt(root, unknownOption)).toBe(before);

    // Fixing the values makes both items valid.
    await opened.writer.updateItem("BUG-13", { repo: "api" }, await versionOf(opened, unknownOption));
    await opened.writer.updateItem("BUG-12", { repo: "site-web" }, await versionOf(opened, missingRequired));
    const bugs = (await opened.catalog.snapshot()).items.filter((item) => item.structure === "bugs");
    expect(itemAt(bugs, unknownOption).problems).toEqual([]);
    expect(itemAt(bugs, missingRequired).problems).toEqual([]);
  });

  test.each([
    { what: "a duplicate handle", handle: "BUG-18", file: "bugs/BUG-18-first.md" },
    { what: "no title", handle: "BUG-11", file: "bugs/BUG-11-no-title.md" },
    { what: "a duplicate id", handle: "BUG-16", file: "bugs/BUG-16-copied.md" },
  ])("an item with $what is never updated, even to fix a value", async ({ what, handle, file }) => {
    const root = writeRoot(FIXTURE_FILES);
    const opened = openItems(root);
    const before = { ...FIXTURE_FILES };

    await refused(opened.writer.updateItem(handle, { repo: "site-web" }, await versionOf(opened, file)), what);

    for (const path of Object.keys(FIXTURE_FILES).filter((path) => path.startsWith("bugs/"))) expect(readAt(root, path), path).toBe(before[path]);
  });

  test("a handle two files share refuses an update or delete sent with either file's own version, and both files stay", async () => {
    const root = writeRoot(FIXTURE_FILES);
    const opened = openItems(root);
    const files = ["bugs/BUG-18-first.md", "bugs/BUG-18-second.md"];
    const before = files.map((file) => readAt(root, file));

    // Each file's current version: a stale_version here would send the caller round a re-read loop it can't leave.
    for (const file of files) {
      await expectWriteError(opened.writer.updateItem("BUG-18", { note: "Seen twice" }, await versionOf(opened, file)), "invalid_fields", `update, ${file}`);
      await expectWriteError(opened.writer.deleteItem("BUG-18", await versionOf(opened, file)), "invalid_fields", `delete, ${file}`);
    }

    expect(files.map((file) => readAt(root, file))).toEqual(before);
  });

  test("through an agent's edit path, a shared handle is refused as a problem only the user can fix, never as a stale version", async () => {
    const copyId = "0196f3c2-9c00-7000-8000-000000000099";
    const copy = `---\nid: ${copyId}\nhandle: BL-1\nproject: wombat\n---\n# Items in Wombat, copied\n\nInvented.\n`;
    const { access, catalog, root } = openAccessRoot({ ...ACCESS_FILES, "backlog/BL-1-copy.md": copy });
    const before = snapshotFiles(root);

    for (const file of ["backlog/BL-1-items.md", "backlog/BL-1-copy.md"]) {
      const version = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "backlog"), file).version;
      await expectRefused(access.update(AGENT, "BL-1", { owner: "Kim" }, version), "invalid_fields", `update, ${file}`);
      await expectRefused(access.remove(AGENT, "BL-1", version), "invalid_fields", `remove, ${file}`);
    }
    expect(snapshotFiles(root)).toEqual(before);
  });

  // The hidden file is read before the visible one in one placement and after it in the other.
  test.each([
    { placement: "in a hidden folder read first", path: "a-kestrel-den/BL-1-kestrel-copy.md", settings: "a-kestrel-den/_structure.yaml" },
    { placement: "in a hidden folder read last", path: "vault/BL-1-kestrel-copy.md", settings: undefined },
  ])("a handle shared with a hidden file ($placement) is refused like any problem only the user can fix, without naming it", async ({ path, settings }) => {
    const hiddenCopyId = "0196f3c2-9a00-7000-8000-000000000003";
    const hiddenCopy = `---\nid: ${hiddenCopyId}\nhandle: BL-1\n---\n# Kestrel copy\n\nKestrel notes.\n`;
    const files: Record<string, string> = { ...ACCESS_FILES, [path]: hiddenCopy };
    if (settings !== undefined) files[settings] = "version: 1\nid: kestrel-den\nname: Kestrel den\nprefix: KDN\naccess: hidden\n";
    const { access, root } = openAccessRoot(files);
    const before = snapshotFiles(root);
    const { version } = await access.get("BL-1");

    for (const [what, call] of [
      ["update", () => access.update(AGENT, "BL-1", { owner: "Kim" }, version)],
      ["remove", () => access.remove(AGENT, "BL-1", version)],
    ] as const) {
      const message = await expectRefused(call(), "invalid_fields", what);
      const error = await refusal(call(), what);
      const text = JSON.stringify({ message, problems: error.problems });
      expect(leaks(text, [MARKER, hiddenCopyId, ...HIDDEN.ids, HIDDEN.structure, HIDDEN.name, "vault/", path]), `${what}: names the hidden file`).toEqual([]);
    }
    expect(snapshotFiles(root)).toEqual(before);
  });

  test("an item with only value problems can be deleted", async () => {
    const root = writeRoot(FIXTURE_FILES);
    const opened = openItems(root);

    await opened.writer.deleteItem("BUG-13", await versionOf(opened, "bugs/BUG-13-unknown-repo.md"));

    expect(existsSync(join(root, "bugs/BUG-13-unknown-repo.md"))).toBe(false);
  });

  test.each([
    { what: "a malformed handle", handle: "bug-7", file: "bugs/lowercase.md", frontmatter: "handle: bug-7\n", field: "handle" },
    { what: "a malformed alias", handle: "BUG-8", file: "bugs/bad-alias.md", frontmatter: "handle: BUG-8\naliases: [old]\n", field: "aliases" },
  ])("$what is the item's own problem, not a clash: the version counts, an update is refused on it, and a delete goes through", async ({ handle, file, frontmatter, field }) => {
    // Backlog too: bugs links to it, and a structure with problems refuses every write before looking at the item.
    const root = writeRoot({ "bugs/_structure.yaml": BUGS_SETTINGS, "backlog/_structure.yaml": BACKLOG_SETTINGS, [file]: `---\nid: 0196f3c2-9e00-7000-8000-0000000000d1\n${frontmatter}repo: api\n---\n# Typed by hand\n\nInvented.\n` });
    const opened = openItems(root);
    const version = await versionOf(opened, file);
    const item = itemAt((await opened.catalog.snapshot()).items, file);
    expect(item.problems.map((problem) => problem.field), "the item's own problem").toContain(field);

    // Not a handle other files share, so a stale version is just stale.
    await expectWriteError(opened.writer.updateItem(handle, { note: "x" }, "0".repeat(64)), "stale_version", "update, old version");
    let error: unknown;
    try {
      await opened.writer.updateItem(handle, { note: "x" }, version);
    } catch (thrown) {
      error = thrown;
    }
    expect(error, "update, current version").toBeInstanceOf(ItemWriteError);
    expect((error as ItemWriteError).code).toBe("invalid_fields");
    expect((error as ItemWriteError).problems.map((problem) => problem.field), "refused on its own field").toEqual([field]);

    // The file parses and no other file has its handle: a delete goes through.
    await opened.writer.deleteItem(handle, version);
    expect(existsSync(join(root, file)), "deleted").toBe(false);
  });
});
