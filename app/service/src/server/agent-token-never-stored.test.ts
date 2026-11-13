// An agent's token lives in the service's memory and the agent's session only.
// It is never written to the store, the service's log, the agent's log entries, the agent's environment, or any
// app answer (agents, logs, proposals); a leaked token would let any local process act as that agent.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, serveItems } from "../../test/mcp-fixtures.ts";

/** Every file next to the database (the database, its WAL and shared memory), as text. */
const storeBytes = (storePath: string) =>
  readdirSync(dirname(storePath))
    .map((name) => readFileSync(join(dirname(storePath), name)).toString("latin1"))
    .join("\n");

describe("the agent token is never stored", () => {
  test(
    "after start, tool calls, a proposal, stop and delete, the token is in no file, log line, entry, env or answer",
    async () => {
      const { s } = await serveItems();
      const kept = await agentConfig(s);
      const removed = await agentConfig(s);
      expect(kept.token.length, "the agent got a token").toBeGreaterThan(0);
      const tokens = [kept.token, removed.token];

      await callTool(s, kept.token, "list_items", { structure: "bugs" });
      await callTool(s, kept.token, "propose_create", { structure: "bugs", title: "A proposal with a token around", reason: "Seen" });
      await callTool(s, removed.token, "get_item", { handle: "BL-1" });
      await s.manager.stop(kept.agentId);
      const keptEntries = JSON.stringify(s.entries(kept.agentId));
      const removedEntries = JSON.stringify(s.entries(removed.agentId));
      await s.manager.delete(removed.agentId);

      const answers = await Promise.all(
        ["/agents", `/agents/${kept.agentId}/log`, "/proposals", "/proposals?status=pending"].map(async (path) => (await s.api("GET", path)).text),
      );
      const places: Record<string, string> = {
        "the store's files": storeBytes(s.storePath),
        "the service's log": JSON.stringify(s.logs),
        "the agents' log entries": keptEntries + removedEntries,
        "the agents' environment": JSON.stringify([kept.env, removed.env]),
        "the app's answers": answers.join("\n"),
      };
      for (const [where, text] of Object.entries(places)) {
        for (const token of tokens) expect(text.includes(token), `a token in ${where}`).toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
