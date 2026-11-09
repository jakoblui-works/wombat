// Lasting check (silent failure): seq never skips. One counter across all agents goes up by exactly one
// per change (item, summary change, delete), is never reused, and carries on across a reopen. The app
// relies on it to notice gaps.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { expect, test } from "vitest";

import { openStore } from "./store.ts";
import { summary, textChunk } from "../../test/store-fixtures.ts";

/** A small cap so that truncation happens during the runs; the product's cap is irrelevant here. */
const CAP = 2048;
const AGENTS = ["a1", "a2", "a3", "a4"];

type Op =
  | { op: "put"; agent: number }
  | { op: "append"; agent: number; count: number; big: boolean }
  | { op: "delete"; agent: number }
  | { op: "reopen" };

const agent = fc.integer({ min: 0, max: AGENTS.length - 1 });
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("put" as const), agent }),
  fc.record({ op: fc.constant("append" as const), agent, count: fc.integer({ min: 1, max: 4 }), big: fc.boolean() }),
  fc.record({ op: fc.constant("delete" as const), agent }),
  fc.constant({ op: "reopen" as const }),
);

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

test("seq never skips: one counter across agents, up by exactly one per change, never reused, across reopen", () => {
  fc.assert(
    fc.property(fc.array(op, { minLength: 1, maxLength: 30 }), (ops) => {
      const dir = mkdtempSync(join(tmpdir(), "wombat-seq-"));
      const path = join(dir, "wombat", "service.db");
      let store: ReturnType<typeof openStore> | undefined;
      try {
        store = openStore({ path, maxItemBytesPerAgent: CAP });
        const dbId = store.dbId;
        const known = new Set<string>();
        let seq = 0;
        expect(store.currentSeq()).toBe(0);

        for (const step of ops) {
          if (step.op === "reopen") {
            store.close();
            store = openStore({ path, maxItemBytesPerAgent: CAP });
            expect(store.dbId).toBe(dbId);
          } else {
            const id = AGENTS[step.agent] ?? "a1";
            if (step.op === "put") {
              expect(store.putAgent(summary(id))).toBe(seq + 1);
              seq += 1;
              known.add(id);
            } else if (step.op === "delete") {
              const result = store.deleteAgent(id);
              if (known.has(id)) {
                expect(result).toBe(seq + 1);
                seq += 1;
                known.delete(id);
              } else {
                expect(result).toBeUndefined();
              }
            } else {
              const entries = range(0, step.count).map((index) =>
                textChunk(`${id} chunk ${index} ${step.big ? "x".repeat(CAP / 2) : ""}`),
              );
              if (known.has(id)) {
                expect(store.append(id, entries)).toEqual(range(seq + 1, step.count));
                seq += step.count;
              } else {
                const current = store;
                expect(() => current.append(id, entries)).toThrow();
              }
            }
          }
          expect(store.currentSeq()).toBe(seq);
        }
      } finally {
        store?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 60 },
  );
});
