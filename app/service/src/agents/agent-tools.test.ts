// Lasting end-to-end check through the manager: an agent the service starts gets the item tools. The fake agent
// (call-tool scenario) calls a tool at the URL and with the header its session/new carried, exactly as a real
// harness would, and reports the tool's answer as its reply. If the mcpServers entry were wrong (port, header,
// name), agents would silently have no tools.
import { describe, expect, test } from "vitest";

import { readAt } from "../../test/items-fixtures.ts";
import { chunkTexts, REPO, TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { serveItems } from "../../test/mcp-fixtures.ts";
import type { Served } from "../../test/server-fixtures.ts";

/** Sends `{ tool, arguments }` to a call-tool agent and returns the answer it reported, parsed. */
const ask = async (s: Served, agentId: string, tool: string, args: Record<string, unknown>) => {
  const turns = s.entries(agentId).filter((entry) => entry.type === "turn_ended").length;
  const chunksBefore = chunkTexts(s.entries(agentId)).length;
  await s.manager.send(agentId, { text: JSON.stringify({ tool, arguments: args }) });
  await s.turnEnded(agentId, turns + 1);
  const reply = chunkTexts(s.entries(agentId)).slice(chunksBefore).join("");
  return JSON.parse(reply) as unknown;
};

describe("agent tools end to end", () => {
  test(
    "a started agent lists items, creates one in an edit structure and proposes one in a propose structure",
    async () => {
      const { s, root } = await serveItems();
      const { id } = await s.manager.start("fake-call-tool", REPO);

      const listed = JSON.stringify(await ask(s, id, "list_items", { structure: "backlog" }));
      expect(listed).toContain("BL-1");

      const created = (await ask(s, id, "create_item", {
        structure: "backlog",
        title: "Created by an agent",
        body: "\nThrough the item tools.\n",
      })) as { written?: string };
      expect(created.written).toMatch(/^BL-\d+$/);
      const item = await s.api("GET", `/items/${created.written ?? ""}`);
      expect(item.status, item.text).toBe(200);
      expect((item.json as { title: string; problems: unknown[]; path: string }).problems).toEqual([]);
      expect(readAt(root, (item.json as { path: string }).path)).toContain("# Created by an agent");

      const proposed = (await ask(s, id, "propose_create", { structure: "bugs", title: "Proposed by an agent", reason: "Found while testing" })) as {
        proposed?: string;
      };
      const proposals = (await s.api("GET", "/proposals?status=pending")).json as { proposals: { id: string; agentId: string; status: string }[] };
      expect(proposals.proposals.find((proposal) => proposal.id === proposed.proposed)).toMatchObject({ agentId: id, status: "pending" });
    },
    TEST_TIMEOUT_MS,
  );
});
