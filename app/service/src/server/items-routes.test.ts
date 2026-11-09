// The items routes on a valid root: shapes, lookup by handle or alias, link values, hidden structures, and the
// refusals. Invalid items over HTTP are items-invalid-visible.test.ts.
import { GetItemResponse, ListItemsResponse, ListStructuresResponse } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { BUGS_SETTINGS, IDS, VALID_FILES, writeAt, writeRoot } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { expectError, serve } from "../../test/server-fixtures.ts";

const HIDDEN_SETTINGS = `version: 1
id: secrets
name: Secrets
prefix: SEC
access: hidden
`;

describe("items routes", () => {
  test(
    "GET /structures lists every structure with its counts, hidden ones included",
    async () => {
      const root = writeRoot(VALID_FILES);
      writeAt(root, "secrets/_structure.yaml", HIDDEN_SETTINGS);
      const s = await serve({ itemsRoot: root });

      const response = await s.api("GET", "/structures");

      expect(response.status, response.text).toBe(200);
      const { structures } = ListStructuresResponse.parse(response.json);
      expect(structures.map((structure) => structure.id).sort()).toEqual(["backlog", "bugs", "docs", "secrets"]);
      const bugs = structures.find((structure) => structure.id === "bugs");
      expect(bugs).toMatchObject({ name: "Bugs", prefix: "BUG", access: "propose", path: "bugs", itemCount: 2, invalidCount: 0 });
      expect(structures.find((structure) => structure.id === "secrets")).toMatchObject({ access: "hidden", itemCount: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "GET /structures/:id/items lists the items without bodies, links as { id, handle }",
    async () => {
      const s = await serve({ itemsRoot: writeRoot(VALID_FILES) });

      const response = await s.api("GET", "/structures/bugs/items");

      expect(response.status, response.text).toBe(200);
      const { items } = ListItemsResponse.parse(response.json);
      expect(items.map((item) => item.handle).sort()).toEqual(["BUG-1", "BUG-2"]);
      const bug1 = items.find((item) => item.handle === "BUG-1");
      expect(bug1?.properties.blocks).toEqual({ id: IDS.bl1, handle: "BL-1" });
      expect(bug1?.properties.repo).toBe("api");
      expect(bug1).not.toHaveProperty("body");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "GET /items/:handle returns the item with its body, and finds it by an old handle",
    async () => {
      const s = await serve({ itemsRoot: writeRoot(VALID_FILES) });

      const byHandle = await s.api("GET", "/items/BL-1");
      const byAlias = await s.api("GET", "/items/BL-3");

      expect(byHandle.status, byHandle.text).toBe(200);
      const item = GetItemResponse.parse(byHandle.json);
      expect(item).toMatchObject({ id: IDS.bl1, handle: "BL-1", aliases: ["BL-3"], title: "Items in Wombat", problems: [] });
      expect(item.body).toContain("Structures, item files and proposals.");
      expect(byAlias.json).toEqual(byHandle.json);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a link to an item that can't be found has a null handle",
    async () => {
      const root = writeRoot(VALID_FILES);
      writeAt(root, "bugs/_structure.yaml", BUGS_SETTINGS);
      const gone = "0196f3c2-9999-7000-8000-000000000001";
      writeAt(
        root,
        "bugs/BUG-3-dangling.md",
        `---\nid: 0196f3c2-1a00-7000-8000-000000000003\nhandle: BUG-3\nrepo: api\nblocks: ${gone}\n---\n# Dangling\n`,
      );
      const s = await serve({ itemsRoot: root });

      const response = await s.api("GET", "/items/BUG-3");

      expect(GetItemResponse.parse(response.json).properties.blocks).toEqual({ id: gone, handle: null });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a handle that is also another item's alias finds the item that has it as its handle",
    async () => {
      const root = writeRoot(VALID_FILES);
      writeAt(root, "backlog/BL-3-new.md", `---\nid: 0196f3c2-2b00-7000-8000-000000000003\nhandle: BL-3\n---\n# Takes the old handle\n`);
      const s = await serve({ itemsRoot: root });

      const response = await s.api("GET", "/items/BL-3");

      expect(GetItemResponse.parse(response.json)).toMatchObject({ id: "0196f3c2-2b00-7000-8000-000000000003", handle: "BL-3" });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an invalid item with a non-string link value is listed and returned as the file holds it",
    async () => {
      const root = writeRoot(VALID_FILES);
      const id = "0196f3c2-1a00-7000-8000-000000000004";
      writeAt(root, "bugs/BUG-4-odd-link.md", `---\nid: ${id}\nhandle: BUG-4\nrepo: api\nblocks: [1, 2]\n---\n# Odd link\n`);
      const s = await serve({ itemsRoot: root });

      const list = ListItemsResponse.parse((await s.api("GET", "/structures/bugs/items")).json);
      const one = await s.api("GET", "/items/BUG-4");

      expect(list.items.find((item) => item.handle === "BUG-4")?.properties.blocks).toEqual([1, 2]);
      expect(one.status, one.text).toBe(200);
      const item = GetItemResponse.parse(one.json);
      expect(item.properties.blocks).toEqual([1, 2]);
      expect(item.problems.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "unknown structures and items are 404 with what to do next",
    async () => {
      const s = await serve({ itemsRoot: writeRoot(VALID_FILES) });

      expectError(await s.api("GET", "/structures/nope/items"), 404, "structure_not_found");
      expectError(await s.api("GET", "/items/NOPE-1"), 404, "item_not_found");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "without an items root every items route is items_not_configured",
    async () => {
      const s = await serve();

      for (const path of ["/structures", "/structures/bugs/items", "/items/BUG-1"]) {
        expectError(await s.api("GET", path), 409, "items_not_configured", path);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
