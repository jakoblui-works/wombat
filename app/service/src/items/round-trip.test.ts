// Lasting check (contract "Item file", silent failure): what the writer writes, the catalog reads
// back. Updating one field changes only that field's bytes (comments, key order and every other line kept) and
// never renames a file; a created item reads back with the title, body and properties it was given.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { findByHandle } from "./catalog.ts";
import { IDS, VALID_FILES, expectWriteError, itemAt, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

const FILE = "bugs/BUG-1-login-times-out.md";
const ORIGINAL = VALID_FILES[FILE] ?? "";
const lines = (text: string) => text.split("\n");

/** The indexes of lines that differ, when both texts have the same number of lines. */
const changedLines = (before: string, after: string) => {
  const a = lines(before);
  const b = lines(after);
  expect(b.length, `line count\n${after}`).toBe(a.length);
  return a.flatMap((line, index) => (line === b[index] ? [] : [index]));
};

describe("item file round trip", () => {
  test.each([
    { field: "repo", value: "site-web", line: /^repo:/ },
    { field: "noted", value: "2026-11-05", line: /^noted:/ },
    { field: "order", value: 7, line: /^order:/ },
    { field: "note", value: "Seen again after the cookie fix", line: /^note:/ },
    { field: "blocks", value: IDS.bl2, line: /^blocks:/ },
    { field: "title", value: "Login times out after 30 seconds on staging", line: /^# / },
  ])("updating $field changes only its line, keeps the path, and reads back", async ({ field, value, line }) => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const before = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE);

    const updated = await writer.updateItem("BUG-1", { [field]: value }, before.version);

    const after = readAt(root, FILE);
    const changed = changedLines(ORIGINAL, after);
    expect(changed, `changed lines\n${after}`).toHaveLength(1);
    expect(lines(after)[changed[0] ?? -1]).toMatch(line);

    const reread = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE);
    const readValue = field === "title" ? reread.title : reread.properties[field];
    expect(readValue).toEqual(value);
    expect(reread.problems).toEqual([]);
    expect(reread.id).toBe(IDS.bug1);
    expect(updated.version).toBe(reread.version);
    expect(updated.version).not.toBe(before.version);
  });

  test("setting a property the file doesn't have yet adds one line and keeps every other", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const file = "bugs/hero-caption.md";
    const before = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), file);

    await writer.updateItem("BUG-2", { noted: "2026-11-06" }, before.version);

    const after = readAt(root, file);
    const added = lines(after).filter((line) => !lines(VALID_FILES[file] ?? "").includes(line));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^noted:/);
    expect(lines(after).filter((line) => line !== added[0])).toEqual(lines(VALID_FILES[file] ?? ""));
    expect(itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), file).properties.noted).toBe("2026-11-06");
  });

  test("updating the body keeps the frontmatter and the title line byte for byte", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const before = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE);
    const body = "\nSteps:\r\n1. Sign in.\n\n<!-- kept as written -->\n    indented code\n";

    await writer.updateItem("BUG-1", { body }, before.version);

    const after = readAt(root, FILE);
    const titleLine = "# Login times out after 30 seconds\n";
    const head = ORIGINAL.slice(0, ORIGINAL.indexOf(titleLine) + titleLine.length);
    expect(after.startsWith(head)).toBe(true);
    expect(itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE).body).toBe(body);
  });

  test("an update that can't change only its field (a value shared through a YAML anchor) is refused, the file unchanged", async () => {
    // `note` reads `repo`'s value through the anchor: changing `repo` in place would change `note` too, or leave
    // the alias pointing nowhere.
    const file = "bugs/BUG-3-anchored.md";
    const text = `---\nid: 0196f3c2-5e00-7000-8000-000000000031\nhandle: BUG-3\nrepo: &r api\nnote: *r\n---\n# Shares a value by anchor\n\nBody.\n`;
    const root = writeRoot({ ...VALID_FILES, [file]: text });
    const { catalog, writer } = openItems(root);
    const before = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), file);
    expect(before.problems, "the anchored file is a valid item").toEqual([]);
    expect(before.properties.note).toBe("api");

    await expectWriteError(writer.updateItem("BUG-3", { repo: "site-web" }, before.version), "invalid_fields", "repo");

    expect(readAt(root, file)).toBe(text);
  });

  test("a created item reads back with the title, body and properties it was given", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const word = fc.stringMatching(/^[\p{L}\p{N}][\p{L}\p{N}'’.,:()-]{0,11}$/u);
    const bodyLine = fc.string({ unit: "grapheme", maxLength: 50 }).map((line) => line.replace(/[\r\n\u2028\u2029]/g, ""));
    const created = fc.record({
      title: fc.array(word, { minLength: 1, maxLength: 8 }).map((words) => words.join(" ")),
      body: fc.tuple(fc.array(bodyLine, { maxLength: 6 }), fc.boolean()).map(([body, end]) => body.join("\n") + (end ? "\n" : "")),
      project: fc.constantFrom("platform", "wombat", undefined),
      parent: fc.constantFrom(IDS.bl1, IDS.bl2, undefined),
    });

    await fc.assert(
      fc.asyncProperty(created, async ({ title, body, project, parent }) => {
        const properties = { ...(project === undefined ? {} : { project }), ...(parent === undefined ? {} : { parent }) };

        const item = await writer.createItem("backlog", { title, body, properties });
        const read = findByHandle((await catalog.snapshot()).items, item.handle ?? "");

        expect(read?.problems).toEqual([]);
        expect(read?.id).toBe(item.id);
        expect(read?.title).toBe(title);
        expect(read?.body).toBe(body);
        expect(read?.properties).toEqual(properties);
        expect(read?.version).toBe(item.version);
      }),
      {
        // The titles and bodies most likely to break a round trip run first, every time, and count toward the
        // 15 runs; the rest are random. Each run costs a create and a full read of the root, so 15 keep the test
        // well inside the timeout when the whole workspace's suites run in parallel.
        examples: [
          [{ title: "Größe prüfen", body: "", project: undefined, parent: undefined }],
          [{ title: "No final newline", body: "\nLast line without one", project: "platform", parent: IDS.bl1 }],
          [{ title: "Looks like markup", body: "---\n# Not the title\n\n  indented: yes\n---\n", project: "wombat", parent: undefined }],
          [{ title: "Blank lines only", body: "\n\n\n", project: undefined, parent: IDS.bl2 }],
        ],
        numRuns: 15,
      },
    );
  });
});
