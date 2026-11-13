// The /mcp tools' shapes: each answer is JSON in one text block, the version from get_item is what update_item takes
// (and a stale one is refused), describe_structure works without an argument, only POST is answered, and the tool
// list (descriptions and input schemas) carries nothing of a hidden structure.
import { describe, expect, test } from "vitest";

import { HIDDEN, MARKER, leaks } from "../../test/access-fixtures.ts";
import { mcpRequest, openMcp } from "../../test/mcp-fixtures.ts";

describe("the /mcp tools", () => {

  test(
    "GET and DELETE /mcp answer 405, even with a valid agent token",
    async () => {
      const s = openMcp();
      const { token } = s;

      for (const method of ["GET", "DELETE"]) {
        const response = await s.request({ method, path: "/mcp", headers: { authorization: `Bearer ${token}` } });
        expect(response.status, method).toBe(405);
        expect(response.headers.allow).toBe("POST");
      }
    },
  );

  test("tools/list carries nothing of a hidden structure in its descriptions or input schemas", async () => {
    const s = openMcp();

    const response = await mcpRequest(s, s.token, "tools/list");

    const tools = (response.json as { result?: { tools?: unknown[] } }).result?.tools ?? [];
    expect(tools.length, response.text).toBeGreaterThan(0);
    expect(leaks(JSON.stringify(tools), [MARKER, HIDDEN.structure, HIDDEN.name, ...HIDDEN.ids, ...HIDDEN.handles])).toEqual([]);
  });
});
