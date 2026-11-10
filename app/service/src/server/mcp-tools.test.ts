// The /mcp tools' shapes: each answer is JSON in one text block, the version from get_item is what update_item takes
// (and a stale one is refused), describe_structure works without an argument, and only POST is answered.
import { describe, expect, test } from "vitest";

import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, mcpRequest, serveItems } from "../../test/mcp-fixtures.ts";
import { rawRequest } from "../../test/server-fixtures.ts";

describe("the /mcp tools", () => {
  test(
    "an answer is JSON in exactly one text block",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);

      const response = await mcpRequest(s, token, "tools/call", { name: "get_item", arguments: { handle: "BL-1" } });

      const content = (response.json as { result: { content: { type: string; text: string }[] } }).result.content;
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(JSON.parse(content[0]?.text ?? "")).toMatchObject({ handle: "BL-1", title: "Items in Wombat" });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "get_item's version is what update_item takes, and the update answers the next one",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);
      const read = (await callTool(s, token, "get_item", { handle: "BL-1" })).json as { version: string };

      const updated = await callTool(s, token, "update_item", { handle: "BL-1", fields: { owner: "Kim" }, version: read.version });
      expect(updated.isError, updated.text).toBe(false);
      const written = updated.json as { written: string; version: string };
      expect(written.written).toBe("BL-1");
      const reread = (await callTool(s, token, "get_item", { handle: "BL-1" })).json as { version: string; properties: Record<string, unknown> };
      expect(reread.properties.owner).toBe("Kim");
      expect(reread.version).toBe(written.version);

      const stale = await callTool(s, token, "update_item", { handle: "BL-1", fields: { owner: "Lee" }, version: read.version });
      expect(stale.isError).toBe(true);
      expect(stale.text).toContain("get_item");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "describe_structure without an argument lists every structure the agent can use",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);

      const answer = await callTool(s, token, "describe_structure", {});

      expect(answer.isError, answer.text).toBe(false);
      const ids = (answer.json as { id: string }[]).map((structure) => structure.id);
      expect(ids).toEqual(expect.arrayContaining(["backlog", "bugs", "docs"]));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "GET and DELETE /mcp answer 405, even with a valid agent token",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);

      for (const method of ["GET", "DELETE"]) {
        const response = await rawRequest(s.port, { method, path: "/mcp", headers: { authorization: `Bearer ${token}` } });
        expect(response.status, method).toBe(405);
        expect(response.headers.allow).toBe("POST");
      }
    },
    TEST_TIMEOUT_MS,
  );
});
