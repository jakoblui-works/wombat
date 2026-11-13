// Drift check: the log read-cases table (shared/test/log-read-cases.ts) against the fake bridge the
// page's data tests use. The service runs the same table against its real store and route
// (service/test/log-read-cases.test.ts), so the fake can't drift from the service.
import { describe, expect, test } from "vitest";

import { ErrorBody, ListLogResponse } from "@wombat/shared/api";
import { INVALID_LOG_QUERIES, LOG_READ_CASES } from "../../shared/test/log-read-cases.ts";
import { fakeService } from "./fake-bridge.ts";
import { user } from "../../shared/test/log-entries.ts";

const AGENT = "agent-hours-1";

describe("log read cases: the fake bridge", () => {
  test.each(LOG_READ_CASES)("$name", async ({ stored, capKeepsNewest, after, limit, expected, truncated }) => {
    const service = fakeService();
    // Another agent's entries first, so this agent's seqs don't start at 1 (as in the store, where seq is store-wide).
    service.append("agent-other", user("elsewhere"));
    service.setAgent(AGENT, {});
    const seqs = Array.from({ length: stored }, (_, i) => service.append(AGENT, user(`entry ${String(i + 1)}`))).flat().map((e) => e.seq);
    const seqOf = (position: number): number => (position === 0 ? 0 : (seqs[position - 1] ?? Number.NaN));
    if (capKeepsNewest !== undefined && stored > capKeepsNewest) service.capDrop(AGENT, seqOf(stored - capKeepsNewest));

    const answer = await service.bridge.service.request("GET", `/agents/${AGENT}/log?after=${String(seqOf(after))}&limit=${String(limit)}`);

    expect(answer.status).toBe(200);
    const read = ListLogResponse.parse(answer.body);
    expect(read.entries.map((entry) => seqs.indexOf(entry.seq) + 1)).toEqual(expected);
    expect(read.truncated).toBe(truncated);
  });

  test("the fake refuses each invalid query with 400 invalid_request and an ErrorBody, as the route does", async () => {
    const service = fakeService();
    service.append(AGENT, user("entry 1"));
    for (const query of INVALID_LOG_QUERIES) {
      const answer = await service.bridge.service.request("GET", `/agents/${AGENT}/log${query}`);
      expect(answer.status, query).toBe(400);
      expect(ErrorBody.parse(answer.body).error.code, query).toBe("invalid_request");
    }
  });
});
