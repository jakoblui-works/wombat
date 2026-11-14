// The /mcp tools' shapes: each answer is JSON in one text block, the version from get_item is what update_item takes
// (and a stale one is refused), describe_structure works without an argument, only POST is answered, and the tool
// list (descriptions and input schemas) carries nothing of a hidden structure. The list offers exactly the tool names
// the rest of the service tells agents to call, and propose_change works without items.
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { TOOL } from "../items/tools.ts";
import { HIDDEN, MARKER, leaks } from "../../test/access-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { callTool, mcpRequest, openMcp, STUB_AGENT, STUB_TOKEN } from "../../test/mcp-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";

type ListedTool = { name: string; inputSchema?: { properties?: Record<string, { items?: { properties?: Record<string, unknown> } }> } };

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

  // The refusals and the instructions file name tools and fields by these names: an agent must find each on the list.
  test("tools/list offers exactly the tool names; propose_change takes path, reason, edits of old and new, and content; revise_proposal takes id, reason, the same edits, content and fields", async () => {
    const s = openMcp();

    const response = await mcpRequest(s, s.token, "tools/list");

    const tools = (response.json as { result?: { tools?: ListedTool[] } }).result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.values(TOOL).sort());
    const input = tools.find((tool) => tool.name === TOOL.proposeChange)?.inputSchema?.properties ?? {};
    expect(Object.keys(input).sort()).toEqual(["content", "edits", "path", "reason"]);
    expect(Object.keys(input.edits?.items?.properties ?? {}).sort()).toEqual(["new", "old"]);
    const revise = tools.find((tool) => tool.name === TOOL.reviseProposal)?.inputSchema?.properties ?? {};
    expect(Object.keys(revise).sort()).toEqual(["content", "edits", "fields", "id", "reason"]);
    expect(Object.keys(revise.edits?.items?.properties ?? {}).sort()).toEqual(["new", "old"]);
  });

  test(
    "without items, propose_change still stores a proposal while an item tool is refused",
    async () => {
      const s = await serve({ agentTokens: { [STUB_TOKEN]: STUB_AGENT } });

      const proposed = await callTool(s, STUB_TOKEN, TOOL.proposeChange, { path: join(s.root, "notes.md"), reason: "Notes for the next session.", content: "# Notes\n" });
      const listed = await callTool(s, STUB_TOKEN, TOOL.listItems, { structure: "bugs" });

      expect(proposed.isError, proposed.text).toBe(false);
      expect(s.store.listProposals().map((proposal) => proposal.id)).toEqual([(proposed.json as { proposed: string }).proposed]);
      expect(listed.isError, listed.text).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
