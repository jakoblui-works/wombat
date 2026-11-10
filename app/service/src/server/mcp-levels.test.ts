// Lasting check (silent failure), the MCP half of "levels and locks at the boundary": every write tool goes through
// the access module, so a write in a `read` structure or past a lock comes back as a tool error (never an HTTP
// error), changes no file and stores no proposal. The codes and the full table are decided, and tested, in
// items/levels-and-locks.test.ts.
import { describe, expect, test } from "vitest";

import { snapshotFiles } from "../../test/access-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, serveItems } from "../../test/mcp-fixtures.ts";

describe("levels and locks through /mcp", () => {
  test(
    "each write tool in a read structure, and an update of a locked field, is a tool error that changes nothing",
    async () => {
      const { s, root } = await serveItems();
      const { token } = await agentConfig(s);
      const versionOf = async (handle: string) => ((await callTool(s, token, "get_item", { handle })).json as { version: string }).version;
      const doc = await versionOf("DOC-1");
      const bl = await versionOf("BL-2");
      const before = snapshotFiles(root);

      const calls: [string, Record<string, unknown>][] = [
        ["create_item", { structure: "docs", title: "Written past read" }],
        ["update_item", { handle: "DOC-1", fields: { title: "Changed past read" }, version: doc }],
        ["delete_item", { handle: "DOC-1", version: doc }],
        ["propose_create", { structure: "docs", title: "Proposed past read", reason: "why" }],
        ["propose_update", { handle: "DOC-1", fields: { title: "Changed past read" }, version: doc, reason: "why" }],
        ["propose_delete", { handle: "DOC-1", version: doc, reason: "why" }],
        ["update_item", { handle: "BL-2", fields: { project: "platform" }, version: bl }],
      ];
      for (const [tool, args] of calls) {
        const answer = await callTool(s, token, tool, args);
        expect(answer.isError, `${tool} ${JSON.stringify(args)}: ${answer.text}`).toBe(true);
        expect(answer.text.trim().length, `${tool}: says what to do`).toBeGreaterThan(0);
      }

      expect(snapshotFiles(root)).toEqual(before);
      const proposals = await s.api("GET", "/proposals");
      expect((proposals.json as { proposals: unknown[] }).proposals).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
