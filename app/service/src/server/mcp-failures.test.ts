// Lasting checks (silent failures) at /mcp's edges: an unexpected error inside a tool (not an Access refusal) reaches
// the agent only as a generic tool error and the log only as the agent, the tool and the error's name, since its
// message may name files or hidden items; and a request body over the 1 MiB limit is refused before any tool runs,
// though /mcp sits outside the app's own body limit.
import { request as httpRequest } from "node:http";

import { describe, expect, test } from "vitest";

import type { Access } from "../items/access.ts";
import { HIDDEN, MARKER, leaks, snapshotFiles } from "../../test/access-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { agentConfig, callTool, isRefused, mcpRequest, serveItems } from "../../test/mcp-fixtures.ts";
import { mcpRoutes } from "./mcp.ts";

const MiB = 1024 * 1024;

describe("/mcp failures", () => {
  test("an unexpected error in a tool answers a generic tool error and logs only the agent, the tool and the error's name", async () => {
    const port = 4123;
    const token = "agent-token-for-the-failure-test";
    const agentId = "agent-failure-test";
    const path = `/home/someone/items/vault/KST-1-${MARKER}-plan.md`;
    class CatalogReadError extends Error {
      override name = "CatalogReadError";
    }
    // What the writer or catalog might throw: a file system error naming a hidden file, and one naming a hidden id.
    const errors = [
      Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES", path }),
      new CatalogReadError(`${HIDDEN.ids[0]} in ${HIDDEN.structure} could not be read from ${path}`),
    ];

    const logs: { event: string; fields: Record<string, unknown> }[] = [];
    let failing: Error = new Error("unset");
    // An Access whose every call fails the way a broken read or write below it would.
    const access = new Proxy({} as Access, { get: () => () => Promise.reject(failing) });
    const app = mcpRoutes({
      access,
      agentForToken: (sent) => (sent === token ? agentId : undefined),
      port: () => port,
      maxBodyBytes: MiB,
      log: (event, fields) => logs.push({ event, fields }),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await app.request("/mcp", {
        method: "POST",
        headers: {
          host: `127.0.0.1:${port}`,
          authorization: `Bearer ${token}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      expect(response.status, name).toBe(200);
      const result = ((await response.json()) as { result?: { isError?: boolean; content?: { type: string; text?: string }[] } }).result;
      return { isError: result?.isError === true, text: result?.content?.map((block) => block.text ?? "").join("\n") ?? "" };
    };

    for (const [tool, args] of [
      ["get_item", { handle: "BL-1" }],
      ["update_item", { handle: "BL-1", fields: { owner: "Kim" }, version: "v" }],
    ] as const) {
      const answers: string[] = [];
      for (const error of errors) {
        failing = error;
        const before = logs.length;
        const answer = await call(tool, args);
        expect(answer.isError, `${tool}, ${error.name}: a tool error`).toBe(true);
        expect(answer.text, `${tool}, ${error.name}: says what to do`).not.toBe("");
        expect(answer.text).not.toContain(error.message);
        expect(leaks(answer.text, [MARKER, path, ...HIDDEN.ids, HIDDEN.structure]), `${tool}, ${error.name}: the answer`).toEqual([]);
        answers.push(answer.text);

        const failed = logs.slice(before).filter((line) => line.event === "tool_failed");
        expect(failed, `${tool}, ${error.name}: one tool_failed line`).toHaveLength(1);
        expect(failed[0]?.fields).toEqual({ agentId, tool, error: error.name });
      }
      // Generic: the answer doesn't depend on what went wrong.
      expect(new Set(answers).size, `${tool}: the same answer for every error`).toBe(1);
    }
    expect(leaks(JSON.stringify(logs), [MARKER, path, ...HIDDEN.ids, HIDDEN.structure, token, "permission denied"]), "the log").toEqual([]);
  });

  test(
    "a request body over 1 MiB is refused before any tool runs, with or without a content-length",
    async () => {
      const { s, root } = await serveItems();
      const { token } = await agentConfig(s);
      const before = snapshotFiles(root);
      const create = (body: string) => ({ structure: "backlog", title: "A large item", body });
      const oversized = create("x".repeat(MiB + 1024));

      // With a content-length.
      const sized = await mcpRequest(s, token, "tools/call", { name: "create_item", arguments: oversized });
      expect(isRefused(sized), `with a content-length: ${sized.status} ${sized.text.slice(0, 200)}`).toBe(true);
      expect(sized.status).toBeLessThan(500);

      // Chunked, so only reading the body can find its size.
      const chunked = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({
          host: "127.0.0.1",
          port: s.port,
          method: "POST",
          path: "/mcp",
          setHost: false,
          headers: {
            host: `127.0.0.1:${s.port}`,
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        const data = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_item", arguments: oversized } }));
        for (let offset = 0; offset < data.length; offset += 64 * 1024) req.write(data.subarray(offset, offset + 64 * 1024));
        req.end();
      });
      expect(chunked, "chunked: refused").toBeGreaterThanOrEqual(400);
      expect(chunked).toBeLessThan(500);

      expect(snapshotFiles(root), "no item was created").toEqual(before);
      // Control: the same call under the limit runs.
      const small = await callTool(s, token, "create_item", create("Invented."));
      expect(small.isError, small.text).toBe(false);
      expect(snapshotFiles(root)).not.toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
