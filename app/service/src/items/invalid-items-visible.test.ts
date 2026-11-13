// Invalid items stay visible. A file the catalog can't parse or
// validate is listed as invalid with a reason naming the field or line, never dropped, and never takes the
// valid items or the list down with it. The HTTP half is server/items-invalid-visible.test.ts.
import { describe, expect, test } from "vitest";

import { type LoadedItem, type Problem } from "./catalog.ts";
import { FIXTURE_FILES, INVALID_BUGS, itemAt, mdFilesIn, openItems, writeRoot } from "../../test/items-fixtures.ts";

const names = (problems: Problem[], fields: string[]) =>
  problems.some(
    (problem) =>
      (problem.field !== undefined && fields.includes(problem.field)) ||
      fields.some((field) => problem.message.includes(field)),
  );

const describeProblems = (item: LoadedItem) => JSON.stringify(item.problems);

describe("invalid items stay visible", () => {
  test("every broken file is listed with a reason naming its field or line, beside every valid item", async () => {
    const root = writeRoot(FIXTURE_FILES);
    const { catalog } = openItems(root);

    const bugs = (await catalog.snapshot()).items.filter((item) => item.structure === "bugs");

    // Nothing dropped: one listed item per file in the folder.
    expect(bugs.map((item) => item.path.split("/").at(-1)).sort()).toEqual(mdFilesIn(root, "bugs").sort());
    for (const { file, what, names: expected } of INVALID_BUGS) {
      const item = itemAt(bugs, `bugs/${file}`);
      expect(item.problems.length, `${what} (${file}) is invalid`).toBeGreaterThan(0);
      if ("line" in expected) {
        expect(
          item.problems.some((problem) => problem.line !== undefined),
          `${what}: a problem names the line: ${describeProblems(item)}`,
        ).toBe(true);
        expect(item.handle, `${what}: the handle of a file that can't be parsed`).toBeNull();
      } else {
        expect(names(item.problems, expected.fields), `${what}: a problem names ${expected.fields.join(" or ")}: ${describeProblems(item)}`).toBe(true);
      }
    }
    for (const file of ["bugs/BUG-1-login-times-out.md", "bugs/hero-caption.md"]) {
      expect(itemAt(bugs, file).problems, `${file} stays valid beside the broken ones`).toEqual([]);
    }
    // The other structures are unaffected.
    expect((await catalog.snapshot()).items.filter((item) => item.structure === "backlog").every((item) => item.problems.length === 0)).toBe(true);
  });

  // Front matter keys are data: one named like a member every object has must read as an unknown key, not as
  // that member (which made reading the root throw, taking every list and tool down).
  test.each(["__proto__"])(
    "a key named %s is an unknown-key problem on its item, and every other item still lists",
    async (key) => {
      const file = `bugs/BUG-30-${key.replaceAll("_", "")}.md`;
      const root = writeRoot({ ...FIXTURE_FILES, [file]: `---\nhandle: BUG-30\nrepo: api\n${key}: hi\n---\n# A key named ${key}\n\nInvented.\n` });
      const { catalog } = openItems(root);

      const structures = (await catalog.snapshot()).structures;
      const bugs = (await catalog.snapshot()).items.filter((item) => item.structure === "bugs");

      expect(structures.length, "the structures still list").toBeGreaterThan(0);
      expect(bugs.map((item) => item.path.split("/").at(-1)).sort()).toEqual(mdFilesIn(root, "bugs").sort());
      const item = itemAt(bugs, file);
      expect(names(item.problems, [key]), `${key}: ${describeProblems(item)}`).toBe(true);
      expect(itemAt(bugs, "bugs/BUG-1-login-times-out.md").problems, "a valid item stays valid").toEqual([]);
    },
  );
});
