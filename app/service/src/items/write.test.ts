// The writer's file names and the writes it refuses: files it creates are named by handle and title, a free
// structure's file is checked like a hand-made one, and a write that wouldn't validate leaves the file as it was.
import { existsSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ItemWriteError } from "./write.ts";
import { BUGS_SETTINGS, VALID_FILES, expectWriteError, mdFilesIn, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

describe("created files", () => {

  test.each([
    { what: "an absolute path", file: "/tmp/deploying.md" },
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
