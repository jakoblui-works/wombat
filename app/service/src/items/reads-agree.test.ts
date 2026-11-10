// A write judges the item (its problems, its id) on the root's full read, and compares the file with the base
// version on a read of its own just before. Both must be of the same bytes: a file that changed and changed back
// (A-B-A) is at the base again, but the full read may have seen the version in between. The filesystem is faked
// at its edge so the full read gets that version deterministically while the file on disk is at the base.
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { VALID_FILES, expectWriteError, itemAt, openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

/** Absolute path → the text its next `readFile` returns instead of the file's (once). */
const swaps = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (async (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
    const swap = typeof path === "string" ? swaps.get(path) : undefined;
    if (swap === undefined) return actual.readFile(path, options ?? null);
    swaps.delete(path as string);
    return options === undefined ? Buffer.from(swap, "utf8") : swap;
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const FILE = "bugs/BUG-9-untitled.md";
const FRONTMATTER = "---\nid: 0196f3c2-9f00-7000-8000-000000000909\nhandle: BUG-9\nrepo: api\n---\n";
/** The base: no title, so no update may touch it (D15). */
const UNTITLED = `${FRONTMATTER}No heading here.\n`;
/** The version in between: sound. */
const TITLED = `${FRONTMATTER}# A titled bug\n\nInvented.\n`;

describe("a write's two reads agree", () => {
  test("an update judged on a full read of other bytes than the file's is refused as stale, by the write and its dry run", async () => {
    const root = writeRoot({ ...VALID_FILES, [FILE]: UNTITLED });
    const { catalog, writer } = openItems(root);
    const base = itemAt(await catalog.items("bugs"), FILE);
    expect(base.problems.length, "the base has a problem only a hand edit fixes").toBeGreaterThan(0);

    for (const [what, call] of [
      ["check", () => writer.check({ kind: "update", handle: "BUG-9", fields: { note: "Seen again" }, baseVersion: base.version })],
      ["update", () => writer.updateItem("BUG-9", { note: "Seen again" }, base.version)],
    ] as const) {
      swaps.set(join(root, FILE), TITLED);
      await expectWriteError(call(), "stale_version", what);
      expect(swaps.size, `${what}: the full read got the version in between`).toBe(0);
    }
    expect(readAt(root, FILE)).toBe(UNTITLED);
  });
});
