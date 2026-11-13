// Lasting checks (silent failures) at /mcp's edges: an unexpected error inside a tool (not an Access refusal) reaches
// the agent only as a generic tool error and the log only as the agent, the tool and the error's name, since its
// message may name files or hidden items; and a request body over the 1 MiB limit is refused before any tool runs,
// though /mcp sits outside the app's own body limit.

import { describe, expect, test } from "vitest";

import type { Access } from "../items/access.ts";
import { HIDDEN, MARKER, leaks } from "../../test/access-fixtures.ts";
import { callTool, openMcp } from "../../test/mcp-fixtures.ts";

describe("/mcp failures", () => {
  test("an unexpected error in a tool answers a generic tool error and logs only the agent, the tool and the error's name", async () => {
    const path = `/home/someone/items/vault/KST-1-${MARKER}-plan.md`;
    class CatalogReadError extends Error {
      override name = "CatalogReadError";
    }
    // What the writer or catalog might throw: a file system error naming a hidden file, and one naming a hidden id.
    const errors = [
      Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES", path }),
      new CatalogReadError(`${HIDDEN.ids[0]} in ${HIDDEN.structure} could not be read from ${path}`),
    ];

    let failing: Error = new Error("unset");
    // An Access whose every call fails the way a broken read or write below it would.
    const mcp = openMcp({ access: new Proxy({} as Access, { get: () => () => Promise.reject(failing) }) });
    const { token, agentId, logs } = mcp;
    const call = (name: string, args: Record<string, unknown>) => callTool(mcp, token, name, args);

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
});
