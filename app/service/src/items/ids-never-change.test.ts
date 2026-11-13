// IDs never change. Once an item has an id, no read and no write changes it,
// and links, which store ids, stay resolvable after a file rename or a hand-made handle change. Without it,
// links point nowhere and nothing shows it.
import { renameSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { findByHandle } from "./catalog.ts";
import {
  BUGS_SETTINGS,
  BACKLOG_SETTINGS,
  FIXTURE_FILES,
  IDS,
  VALID_FILES,
  frontmatterValue,
  handleNumber,
  itemAt,
  openItems,
  readAt,
  writeAt,
  writeRoot,
} from "../../test/items-fixtures.ts";

const UNASSIGNED = "---\nrepo: api\n---\n# Typed by hand\n\nNo id yet.\n";

describe("IDs never change on read", () => {

  test("two reads at once give an unassigned file one id and one handle, taking one number", async () => {
    const root = writeRoot({
      "bugs/_structure.yaml": BUGS_SETTINGS,
      "backlog/_structure.yaml": BACKLOG_SETTINGS,
      "bugs/typed.md": UNASSIGNED,
    });
    const { catalog, store } = openItems(root);

    const [a, b] = await Promise.all([catalog.snapshot(), catalog.snapshot(), catalog.snapshot()]);

    const onDisk = readAt(root, "bugs/typed.md");
    for (const { items } of [a, b]) {
      const item = itemAt(items.filter((item) => item.structure === "bugs"), "bugs/typed.md");
      expect(item.id).toBe(frontmatterValue(onDisk, "id"));
      expect(item.handle).toBe(frontmatterValue(onDisk, "handle"));
    }
    // Whatever the interleaving, two concurrent first sights of one file take one number: with no other bug
    // that is number 1, so the next number is 2.
    expect(handleNumber(frontmatterValue(onDisk, "handle") ?? null)).toBe(1);
    expect(store.nextHandleNumber("bugs", 0), "numbers taken by the reads").toBe(2);
  });

  test("a read rewrites no file that already has an id (duplicate ids included) and none in a broken structure", async () => {
    const root = writeRoot(FIXTURE_FILES);
    const { catalog } = openItems(root);

    for (let read = 0; read < 4; read += 1) await catalog.snapshot();

    for (const file of ["bugs/BUG-16-copied.md", "bugs/BUG-17-copy-of-16.md", "bugs/BUG-1-login-times-out.md", "backlog/BL-2-proposal-view.md", "broken/BRK-1-orphan.md"]) {
      expect(readAt(root, file), file).toBe(FIXTURE_FILES[file]);
    }
    expect(frontmatterValue(readAt(root, "bugs/BUG-17-copy-of-16.md"), "id")).toBe(IDS.duplicateId);
  });
});

describe("IDs never change on write", () => {

  test("a link still resolves after its target's file is renamed and its handle changed by hand", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    // By hand: rename BL-1's file, give it a new handle, and keep the old one as an alias.
    renameSync(join(root, "backlog/BL-1-items-in-wombat.md"), join(root, "backlog/items-ideas.md"));
    writeAt(
      root,
      "backlog/items-ideas.md",
      readAt(root, "backlog/items-ideas.md").replace("handle: BL-1\naliases: [BL-3]", "handle: BL-30\naliases: [BL-3, BL-1]"),
    );

    const child = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "backlog"), "backlog/BL-2-proposal-view.md");
    expect(child.problems).toEqual([]);
    expect(child.properties.parent).toBe(IDS.bl1);
    expect(findByHandle((await catalog.snapshot()).items, "BL-30")?.id).toBe(IDS.bl1);
    expect(findByHandle((await catalog.snapshot()).items, "BL-1")?.id).toBe(IDS.bl1);

    // A write to the child keeps the link as the id; a write to the renamed target keeps its path and id.
    const updated = await writer.updateItem("BL-2", { title: "A view for proposals, step 7" }, child.version);
    expect(updated.properties.parent).toBe(IDS.bl1);
    const target = findByHandle((await catalog.snapshot()).items, "BL-30");
    const renamed = await writer.updateItem("BL-30", { project: "platform" }, target?.version ?? "");
    expect(renamed.id).toBe(IDS.bl1);
    expect(renamed.path).toMatch(/(^|\/)backlog\/items-ideas\.md$/);
  });
});
