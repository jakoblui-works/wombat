// Drift check (S4 fix round): the log read-cases table (shared/test/log-read-cases.ts) against the service's real
// store, and its refused queries against the route. The desktop runs the same table against its fake bridge, so the
// fake the page's tests rely on can't drift from what the service does.
import { describe, expect, test } from "vitest";

import { ErrorBody } from "@wombat/shared/api";
import { INVALID_LOG_QUERIES, LOG_READ_CASES } from "../../shared/test/log-read-cases.ts";
import { TEST_TIMEOUT_MS } from "./manager-fixtures.ts";
import { serve } from "./server-fixtures.ts";
import { open, summary, tempStorePath } from "./store-fixtures.ts";
import type { NewLogEntry } from "../src/store/store.ts";

const AGENT = "agent-hours-1";
const AT = "2026-11-09T10:00:00.000Z";

// Entries of one size (one-digit positions), so a cap of K entries' bytes keeps exactly the newest K.
const entry = (position: number): NewLogEntry => ({ type: "user_message", text: `entry ${String(position % 10)}`, at: AT });
const size = (position: number): number => Buffer.byteLength(JSON.stringify(entry(position)));

describe("log read cases: the real store", () => {
  test.each(LOG_READ_CASES)("$name", ({ stored, capKeepsNewest, after, limit, expected, truncated }) => {
    const store = open({ path: tempStorePath(), ...(capKeepsNewest === undefined ? {} : { maxLogBytesPerAgent: capKeepsNewest * size(1) }) });
    store.putAgent(summary(AGENT));
    const seqs = Array.from({ length: stored }, (_, i) => store.append(AGENT, [entry(i + 1)])).flat();
    const seqOf = (position: number): number => (position === 0 ? 0 : (seqs[position - 1] ?? Number.NaN));

    const read = store.readLog(AGENT, seqOf(after), limit);

    expect(read.entries.map((stored) => seqs.indexOf(stored.seq) + 1)).toEqual(expected);
    expect(read.truncated).toBe(truncated);
  });
});

test(
  "log read cases: the route refuses each invalid query with 400 invalid_request and an ErrorBody",
  async () => {
    const s = await serve();
    s.store.putAgent(summary(AGENT));
    for (const query of INVALID_LOG_QUERIES) {
      const response = await s.api("GET", `/agents/${AGENT}/log${query}`);
      expect(response.status, query).toBe(400);
      expect(ErrorBody.parse(response.json).error.code, query).toBe("invalid_request");
    }
  },
  TEST_TIMEOUT_MS,
);
