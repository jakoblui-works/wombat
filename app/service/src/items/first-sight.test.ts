// Lasting check (silent failure): the first read of a hand-made file writes only what the service owns, and
// never leaves a file it can't read back. A file without an id and handle gets both and keeps every other byte
// (a BOM, CRLF, comments, key order, blank lines, a missing final newline); a file with no title, or a
// fence-like line where frontmatter would start, isn't written and is listed invalid; a hand-typed handle or
// alias in a link field becomes the target's id and nothing else changes; a link the catalog can't resolve
// leaves the file as it is.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  BACKLOG_SETTINGS,
  BUGS_SETTINGS,
  DOCS_SETTINGS,
  IDS,
  UUID_V7,
  VALID_FILES,
  frontmatterKeys,
  frontmatterValue,
  itemAt,
  openItems,
  readAt,
  withoutAssigned,
  writeRoot,
} from "../../test/items-fixtures.ts";

const word = fc.stringMatching(/^[A-Za-z][a-z]{1,9}$/);
/** One body line: any graphemes but line breaks. */
const bodyLine = fc.string({ unit: "grapheme", maxLength: 40 }).map((line) => line.replace(/[\r\n\u2028\u2029]/g, ""));
const handMade = fc.record({
  comment: fc.boolean(),
  note: fc.option(fc.array(word, { minLength: 1, maxLength: 5 }).map((words) => words.join(" ")), { nil: undefined }),
  blankBeforeTitle: fc.integer({ min: 0, max: 2 }),
  title: fc.array(word, { minLength: 1, maxLength: 6 }).map((words) => words.join(" ")),
  lines: fc.array(bodyLine, { maxLength: 6 }),
  crlf: fc.boolean(),
  frontmatterCrlf: fc.boolean(),
  bom: fc.boolean(),
  finalNewline: fc.boolean(),
});

type HandMade = {
  comment: boolean;
  note: string | undefined;
  blankBeforeTitle: number;
  title: string;
  lines: string[];
  crlf: boolean;
  frontmatterCrlf: boolean;
  bom: boolean;
  finalNewline: boolean;
};

const handMadeText = (file: HandMade) => {
  const eol = file.crlf ? "\r\n" : "\n";
  const head = file.frontmatterCrlf ? "\r\n" : "\n";
  const body = file.lines.join(eol) + (file.finalNewline ? eol : "");
  return (
    (file.bom ? "\uFEFF" : "") +
    `---${head}` +
    (file.comment ? `# typed by hand${head}` : "") +
    `repo: api${head}` +
    (file.note === undefined ? "" : `note: ${file.note}${head}`) +
    `---${head}` +
    head.repeat(file.blankBeforeTitle) +
    `# ${file.title}${head}` +
    body
  );
};

const BUGS_ROOT = { "bugs/_structure.yaml": BUGS_SETTINGS, "backlog/_structure.yaml": BACKLOG_SETTINGS };

/**
 * Reads `file` once and checks what a read may leave behind: either the file as it was, or a file a fresh
 * catalog (after a restart) reads as valid with the same id. Returns the first read's item and the bytes after it.
 */
const readOnce = async (files: Record<string, string>, structure: string, file: string) => {
  const root = writeRoot(files);
  const opened = openItems(root);
  const item = itemAt((await opened.catalog.snapshot()).items.filter((item) => item.structure === structure), file);
  const written = readAt(root, file);
  if (written !== files[file]) {
    const reread = itemAt((await opened.reopen().catalog.snapshot()).items.filter((item) => item.structure === structure), file);
    expect(reread.problems, `the written file reads back valid:\n${JSON.stringify(written)}`).toEqual([]);
    expect(reread.id).toBe(item.id);
  }
  return { item, written };
};

/** The text with an id written in quotes read as written plain, so the check doesn't pin YAML's quoting. */
const unquoteIds = (text: string, ids: string[]) =>
  ids.reduce((result, id) => result.replaceAll(`"${id}"`, id).replaceAll(`'${id}'`, id), text);

describe("first sight", () => {
  test("a hand-made file gets an id and a handle and keeps every other byte", async () => {
    await fc.assert(
      fc.asyncProperty(handMade, async (file) => {
        const original = handMadeText(file);

        const { item, written } = await readOnce({ ...BUGS_ROOT, "bugs/typed-by-hand.md": original }, "bugs", "bugs/typed-by-hand.md");

        expect(item.problems).toEqual([]);
        expect(item.id).toMatch(UUID_V7);
        expect(item.handle).toMatch(/^BUG-\d+$/);
        expect(frontmatterValue(written, "id")).toBe(item.id);
        expect(frontmatterValue(written, "handle")).toBe(item.handle);
        expect(withoutAssigned(written)).toBe(original);
        // The inserted lines end like the frontmatter's own lines, so a CRLF file gets no bare LF.
        const eol = file.frontmatterCrlf ? "\r\n" : "\n";
        for (const key of ["id", "handle"]) expect(new RegExp(`^[ \\t]*${key}:[^\\r\\n]*(\\r?\\n)`, "m").exec(written)?.[1], `${key} line's ending`).toBe(eol);
      }),
      { numRuns: 25 },
    );
  });

  test.each([
    { what: "a trailing space on the opening fence", text: "--- \nrepo: api\n---\n# A fence with a trailing space\n", line: 1 },
    { what: "a blank line before the fence", text: "\n---\nrepo: api\n---\n# A blank line before the fence\n", line: 2 },
  ])("a file with $what isn't written and is listed invalid at the fence's line", async ({ text, line }) => {
    const { item, written } = await readOnce({ ...BUGS_ROOT, "bugs/fence.md": text }, "bugs", "bugs/fence.md");

    expect(written).toBe(text);
    expect(item.problems.some((problem) => problem.line === line), JSON.stringify(item.problems)).toBe(true);
  });

  test.each([
    { what: "frontmatter and an H2 first", structure: "bugs", file: "bugs/no-title.md", text: "---\nrepo: api\n---\n## Steps\n\nNo H1 anywhere.\n" },
    { what: "no frontmatter and plain text first", structure: "docs", file: "guides/no-title.md", text: "Notes before any heading.\n\n# Too late\n" },
  ])("a file without a valid title ($what) is never written and is listed invalid", async ({ structure, file, text }) => {
    const { item, written } = await readOnce({ ...BUGS_ROOT, "_structure.yaml": DOCS_SETTINGS, [file]: text }, structure, file);

    expect(written).toBe(text);
    expect(item.problems.length).toBeGreaterThan(0);
  });

  test("an indented frontmatter map gets id and handle at the map's indentation and keeps every other byte", async () => {
    const text = "---\n  repo: api\n  note: Indented by hand\n---\n# Indented frontmatter\n\nBody.\n";

    const { item, written } = await readOnce({ ...BUGS_ROOT, "bugs/indented.md": text }, "bugs", "bugs/indented.md");

    expect(written, "the file is written").not.toBe(text);
    expect(item.problems).toEqual([]);
    expect(written).toContain(`\n  id: ${item.id ?? ""}\n`);
    expect(written).toContain(`\n  handle: ${item.handle ?? ""}\n`);
    expect(withoutAssigned(written)).toBe(text);
  });

  test("a first-sight edit that wouldn't read back as the same data is skipped: the file stays as it is", async () => {
    // A folded link value: replacing its scalar in place can't keep the YAML intact.
    const text = `---\nid: 0196f3c2-5e00-7000-8000-000000000009\nrepo: api\nblocks: >-\n  BL-2\n---\n# A folded link by hand\n\nBody.\n`;

    const { item, written } = await readOnce({ ...VALID_FILES, "bugs/folded.md": text }, "bugs", "bugs/folded.md");

    expect(written).toBe(text);
    expect(item.problems.length, "the skipped write shows as a problem").toBeGreaterThan(0);
  });

  test("a hand-made document without frontmatter gets one with only id and handle, and the rest unchanged", async () => {
    const original = "# Deploying\n\nRun the release workflow, then check `/health`.\n";
    const root = writeRoot({ "_structure.yaml": DOCS_SETTINGS, "guides/deploy.md": original });
    const { catalog } = openItems(root);

    const item = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "docs"), "guides/deploy.md");
    const written = readAt(root, "guides/deploy.md");

    expect(item.problems).toEqual([]);
    expect(frontmatterKeys(written).sort()).toEqual(["handle", "id"]);
    expect(written.endsWith(original)).toBe(true);
    expect(withoutAssigned(written)).toBe(original);
    expect(item.title).toBe("Deploying");
  });

  test("a handle or alias typed into a link field becomes the target's id; nothing else changes", async () => {
    const byHandle = `---\nid: 0196f3c2-5e00-7000-8000-000000000001\nhandle: BUG-5\nrepo: api\nblocks: BL-2\n---\n# Linked by handle\n\nBody kept.\n`;
    const byAlias = `---\nid: 0196f3c2-5e00-7000-8000-000000000002\nhandle: BUG-6\n# the old number\nrepo: api\nblocks: BL-3\n---\n# Linked by an old handle\n`;
    const root = writeRoot({ ...VALID_FILES, "bugs/BUG-5-by-handle.md": byHandle, "bugs/BUG-6-by-alias.md": byAlias });
    const { catalog } = openItems(root);

    const bugs = (await catalog.snapshot()).items.filter((item) => item.structure === "bugs");

    expect(itemAt(bugs, "bugs/BUG-5-by-handle.md").properties.blocks).toBe(IDS.bl2);
    expect(itemAt(bugs, "bugs/BUG-6-by-alias.md").properties.blocks).toBe(IDS.bl1);
    expect(unquoteIds(readAt(root, "bugs/BUG-5-by-handle.md"), [IDS.bl2])).toBe(byHandle.replace("blocks: BL-2", `blocks: ${IDS.bl2}`));
    expect(unquoteIds(readAt(root, "bugs/BUG-6-by-alias.md"), [IDS.bl1])).toBe(byAlias.replace("blocks: BL-3", `blocks: ${IDS.bl1}`));
  });

  test("a link naming an item of another structure, or no item, leaves the file as it is and the item invalid", async () => {
    const wrongStructure = `---\nid: 0196f3c2-5e00-7000-8000-000000000003\nhandle: BUG-7\nrepo: api\nblocks: BUG-1\n---\n# Links a bug where a backlog item belongs\n`;
    const unknown = `---\nid: 0196f3c2-5e00-7000-8000-000000000004\nhandle: BUG-8\nrepo: api\nblocks: BL-404\n---\n# Links nothing\n`;
    const root = writeRoot({ ...VALID_FILES, "bugs/BUG-7-wrong.md": wrongStructure, "bugs/BUG-8-unknown.md": unknown });
    const { catalog } = openItems(root);

    const bugs = (await catalog.snapshot()).items.filter((item) => item.structure === "bugs");

    for (const [file, text] of [
      ["bugs/BUG-7-wrong.md", wrongStructure],
      ["bugs/BUG-8-unknown.md", unknown],
    ] as const) {
      expect(itemAt(bugs, file).problems.length, file).toBeGreaterThan(0);
      expect(readAt(root, file), file).toBe(text);
    }
  });
});
