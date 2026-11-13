// S2c, T13 (rows T13-15, T13-16): which harnesses GET /harnesses says offer the context breakdown, and POST
// /agents/:id/context's body and statuses. What the hidden turn leaves behind is hidden-turn.test.ts's.
import { ContextBreakdown, ListHarnessesResponse } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { FAKE_BREAKDOWN } from "../../test/fake-agent.ts";
import { NO_CONTEXT_HARNESS, NO_RESUME_HARNESS, REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { expectError, serve, type Served } from "../../test/server-fixtures.ts";

const startAgent = async (s: Served, harness: string): Promise<string> => {
  const started = await s.api("POST", "/agents", { harness, repo: REPO });
  expect(started.status, started.text).toBe(201);
  return (started.json as { id: string }).id;
};

test("T13-15: GET /harnesses lists the context feature exactly for the harnesses with contextBreakdown", async () => {
  const s = await serve();
  const response = await s.api("GET", "/harnesses");
  expect(response.status, response.text).toBe(200);
  const features = new Map(ListHarnessesResponse.parse(response.json).map(({ id, features }) => [id, features]));

  // S2d adds "resume" beside it (a builder's row), so the context feature is checked on its own here.
  expect(features.get("fake-reply")).toContain("context");
  expect(features.get(NO_CONTEXT_HARNESS)).not.toContain("context");
});

test(
  "T13-16: POST /agents/:id/context answers a body ContextBreakdown parses",
  async () => {
    const s = await serve();
    const id = await startAgent(s, "fake-reply");
    const response = await s.api("POST", `/agents/${id}/context`);
    expect(response.status, response.text).toBe(200);
    expect(ContextBreakdown.parse(response.json)).toEqual(FAKE_BREAKDOWN);
  },
  TEST_TIMEOUT_MS,
);

test(
  "T13-16: busy, not_running and unsupported answer 409 with their codes",
  async () => {
    const s = await serve();
    const working = await startAgent(s, "fake-hang");
    const sent = await s.api("POST", `/agents/${working}/messages`, { text: "Take your time" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor("state working", () => s.agent(working)?.state === "working");
    expectError(await s.api("POST", `/agents/${working}/context`), 409, "busy", "during a turn");

    // S2d, D26: a stopped agent is started by /context, unless its harness can't resume (D28).
    const stopped = await startAgent(s, NO_RESUME_HARNESS);
    const stop = await s.api("POST", `/agents/${stopped}/stop`);
    expect(stop.status, stop.text).toBe(204);
    expectError(await s.api("POST", `/agents/${stopped}/context`), 409, "not_running", "a stopped agent");

    const plain = await startAgent(s, NO_CONTEXT_HARNESS);
    expectError(await s.api("POST", `/agents/${plain}/context`), 409, "unsupported", "a harness without the feature");
  },
  TEST_TIMEOUT_MS,
);
