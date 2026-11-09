// Lasting check (silent failure), the HTTP half of "Invalid items stay visible": on a root with
// broken items and a broken `_structure.yaml`, the items routes answer 200 with every file and its problems.
// The catalog's half (which problems) is items/invalid-items-visible.test.ts; this one guards what only the route
// can break: an answer checked against the shared schemas that refuses an invalid item's shape (no handle, odd
// property values) and fails the whole list.
import { describe, expect, test } from "vitest";

import { FIXTURE_FILES, INVALID_BUGS, mdFilesIn, writeRoot } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";

type Problems = { problems: unknown[] };
type Structure = Problems & { id: string | null; path: string; itemCount: number; invalidCount: number };
type Item = Problems & { handle: string | null; path: string; body?: string };

describe("invalid items stay visible over HTTP", () => {
  test(
    "the structures and a structure's items list every file, invalid ones with their problems",
    async () => {
      const root = writeRoot(FIXTURE_FILES);
      const s = await serve({ itemsRoot: root });

      const structures = await s.api("GET", "/structures");
      expect(structures.status, structures.text).toBe(200);
      const listed = (structures.json as { structures: Structure[] }).structures;
      const broken = listed.find((structure) => structure.path === "broken" || structure.path.endsWith("/broken"));
      expect(broken?.id, "the broken settings are listed").toBeNull();
      expect(broken?.problems.length).toBeGreaterThan(0);

      const items = await s.api("GET", "/structures/bugs/items");
      expect(items.status, items.text).toBe(200);
      const bugs = (items.json as { items: Item[] }).items;
      expect(bugs).toHaveLength(mdFilesIn(root, "bugs").length);
      for (const { file, what } of INVALID_BUGS) {
        const item = bugs.find((candidate) => candidate.path.endsWith(file));
        expect(item?.problems.length, `${what} (${file})`).toBeGreaterThan(0);
      }
      expect(bugs.find((item) => item.path.endsWith("BUG-10-bad-yaml.md"))?.handle).toBeNull();

      const summary = listed.find((structure) => structure.id === "bugs");
      expect(summary?.itemCount).toBe(bugs.length);
      expect(summary?.invalidCount).toBe(INVALID_BUGS.length);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an invalid item with a handle is returned by it, with its problems and body",
    async () => {
      const s = await serve({ itemsRoot: writeRoot(FIXTURE_FILES) });

      const response = await s.api("GET", "/items/BUG-13");

      expect(response.status, response.text).toBe(200);
      const item = response.json as Item;
      expect(item.handle).toBe("BUG-13");
      expect(item.problems.length).toBeGreaterThan(0);
      expect(item.body).toContain("It broke by hand.");
    },
    TEST_TIMEOUT_MS,
  );
});
