// The routes' error mapping over real HTTP: a manager or workspace error keeps its status and code, and a body that
// breaks the contract changes nothing.
import { AgentSummary } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { expectError, serve } from "../../test/server-fixtures.ts";

describe("routes", () => {
  test(
    "an agent error and a repo error answer with their own status and an ErrorBody carrying their code, not 500",
    async () => {
      const s = await serve();
      expectError(await s.api("POST", "/agents/agt_does_not_exist/messages", { text: "Hello" }), 404, "not_found", "an unknown agent");
      expectError(await s.api("POST", "/agents", { harness: "fake-reply", repo: "missing" }), 422, "repo_not_found", "a missing repo");
      expect(s.pids(), "nothing was spawned").toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a body that isn't JSON or breaks the strict schema gets 400 with an ErrorBody, and nothing reaches the agent",
    async () => {
      const s = await serve();
      const started = await s.api("POST", "/agents", { harness: "fake-reply", repo: REPO });
      expect(started.status, started.text).toBe(201);
      const { id } = AgentSummary.parse(started.json);
      const messages = `/agents/${id}/messages`;
      const seq = s.store.currentSeq();

      expectError(await s.api("POST", messages, "{not json"), 400, "invalid_request", "a body that isn't JSON");
      expectError(await s.api("POST", messages, { text: "Hello", extra: true }), 400, "invalid_request", "an unknown field");

      expect(s.store.currentSeq()).toBe(seq);
      expect(s.agent(id)?.state).toBe("done");
    },
    TEST_TIMEOUT_MS,
  );
});
