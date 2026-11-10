// Lasting check (silent failure), the MCP half of "hidden never reaches an agent": what only the endpoint adds (the
// tool list with its descriptions and input schemas, and how answers and refusals are wrapped) carries nothing of a
// hidden structure, and a hidden handle or structure is refused like a missing one. The access module's half is
// items/hidden-never-reaches-agent.test.ts.
import { describe, expect, test } from "vitest";

import { HIDDEN, MARKER, leaks } from "../../test/access-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, mcpRequest, serveItems } from "../../test/mcp-fixtures.ts";

const HIDDEN_STRINGS = [MARKER, ...HIDDEN.ids, ...HIDDEN.handles, HIDDEN.structure, HIDDEN.name];

describe("hidden never reaches an agent through /mcp", () => {
  test(
    "the tool list and every read tool's answer carry nothing of the hidden structure",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);

      const listed = await mcpRequest(s, token, "tools/list");
      expect(listed.status, listed.text).toBe(200);
      const answers = [
        await callTool(s, token, "describe_structure", {}),
        await callTool(s, token, "describe_structure", { structure: "bugs" }),
        await callTool(s, token, "list_items", { structure: "bugs" }),
        await callTool(s, token, "get_item", { handle: "BUG-1" }),
        await callTool(s, token, "search", { query: MARKER }),
        await callTool(s, token, "search", { query: "plan" }),
      ];

      expect(leaks(listed.text, HIDDEN_STRINGS), "tools/list").toEqual([]);
      for (const answer of answers) {
        expect(answer.isError, answer.text).toBe(false);
        expect(leaks(answer.text, HIDDEN_STRINGS), answer.text).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hidden handle or structure is refused with the same text as a missing one",
    async () => {
      const { s } = await serveItems();
      const { token } = await agentConfig(s);
      const pairs = [
        { tool: "get_item", hidden: { handle: "KST-1" }, missing: { handle: "KST-99" }, typed: ["KST-1", "KST-99"] },
        { tool: "describe_structure", hidden: { structure: HIDDEN.structure }, missing: { structure: "no-such-structure" }, typed: [HIDDEN.structure, "no-such-structure"] },
        { tool: "list_items", hidden: { structure: HIDDEN.structure }, missing: { structure: "no-such-structure" }, typed: [HIDDEN.structure, "no-such-structure"] },
        {
          tool: "propose_delete",
          hidden: { handle: "KST-1", version: "v", reason: "why" },
          missing: { handle: "KST-99", version: "v", reason: "why" },
          typed: ["KST-1", "KST-99"],
        },
      ] as const;

      for (const { tool, hidden, missing, typed } of pairs) {
        const a = await callTool(s, token, tool, hidden);
        const b = await callTool(s, token, tool, missing);
        expect(a.isError && b.isError, `${tool}: both refused`).toBe(true);
        expect(a.text.replaceAll(typed[0], "<typed>"), tool).toBe(b.text.replaceAll(typed[1], "<typed>"));
        expect(leaks(a.text.replaceAll(typed[0], "<typed>"), [MARKER, ...HIDDEN.ids, HIDDEN.name]), tool).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
