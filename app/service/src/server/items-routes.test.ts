// The items routes on a valid root: shapes, lookup by handle or alias, link values, hidden binders, and the
// refusals, and problems sent with only the shared Problem's keys. Invalid items over HTTP are
// items-invalid-visible.test.ts.
import { describe, expect, test } from "vitest";

import { extraProblemKeys } from "../../test/access-fixtures.ts";
import { FIXTURE_FILES, writeRoot } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";
import { SETTINGS_FILE } from "../items/binders.ts";

const HIDDEN_SETTINGS = `version: 1
id: secrets
name: Secrets
prefix: SEC
access: hidden
`;

describe("items routes", () => {

  test(
    "binders and items are sent with problems that carry only the shared Problem's keys",
    async () => {
      // Every kind of problem: broken settings, a prefix clash with a hidden binder, and one invalid file per way.
      const root = writeRoot({ ...FIXTURE_FILES, [`secrets/${SETTINGS_FILE}`]: HIDDEN_SETTINGS.replace("prefix: SEC", "prefix: BL") });
      const s = await serve({ itemsRoot: root });

      /** A route's JSON as sent (a schema parse would drop extra keys), and the number of problems in it. */
      const sent = async (path: string) => {
        const response = await s.api("GET", path);
        expect(response.status, `${path}: ${response.text}`).toBe(200);
        return { json: response.json, problems: (response.text.match(/"message":/g) ?? []).length };
      };
      const binders = await sent("/binders");
      const listings = (binders.json as { binders: { id: string | null }[] }).binders;
      // The app reads the catalog itself, not an agent's view of it: the user sees hidden binders too.
      expect(JSON.stringify(listings)).toContain("secrets");
      const answers = [{ path: "/binders", ...binders }];
      for (const { id } of listings) {
        if (id === null) continue;
        const items = await sent(`/binders/${id}/items`);
        answers.push({ path: `/binders/${id}/items`, ...items });
        for (const { handle, problems } of (items.json as { items: { handle: string | null; problems: unknown[] }[] }).items) {
          if (handle !== null && problems.length > 0) answers.push({ path: `/items/${handle}`, ...(await sent(`/items/${encodeURIComponent(handle)}`)) });
        }
      }

      expect(answers.find(({ path }) => path === "/binders")?.problems, "binder problems sent").toBeGreaterThan(0);
      expect(answers.filter(({ path }) => path.startsWith("/items/")).length, "items with problems fetched").toBeGreaterThan(0);
      for (const { path, json } of answers) expect(extraProblemKeys(json), path).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
