// POST /agents/:id/config sends the manager's invalid_request (a value the option doesn't take) as a 400, like a body
// off the contract. The manager's checks themselves are set-config.test.ts's.
import { expect, test } from "vitest";

import { FAKE_CONFIG } from "../../test/fake-agent.ts";
import { REPO, TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { expectError, serve } from "../../test/server-fixtures.ts";

test(
  "a value the option doesn't offer answers invalid_request (400)",
  async () => {
    const s = await serve();
    const started = await s.api("POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBe(201);
    const { id } = started.json as { id: string };
    const response = await s.api("POST", `/agents/${id}/config`, { configId: FAKE_CONFIG.model.id, value: "huge-model" });
    expectError(response, 400, "invalid_request", "model=huge-model");
  },
  TEST_TIMEOUT_MS,
);
