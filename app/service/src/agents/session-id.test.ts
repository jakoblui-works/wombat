// The ACP sessionId each session update and permission request arrived with is stored in the entry's body and
// served by the log route, so entries from other sessions (sub-agents, later) need no store migration.
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";

const CARRIERS = ["session_update", "permission_requested", "permission_answered"];

describe("sessionId on entries", () => {
  test(
    "every session update and permission entry stores the agent's ACP sessionId, and the log route serves it",
    async () => {
      const s = await serve();
      const agent = await s.manager.start("fake-permission", REPO);
      await s.manager.send(agent.id, { text: "Edit the notes" });
      await waitFor("a pending permission", () => s.agent(agent.id)?.state === "waiting");
      const request = s.entries(agent.id).find((entry) => entry.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      s.manager.answer(agent.id, request.requestId, "allow_once");
      await s.turnEnded(agent.id);
      expect(agent.sessionId).not.toBe("");

      const stored = s.entries(agent.id).filter((entry) => CARRIERS.includes(entry.type));
      expect(new Set(stored.map((entry) => entry.type))).toEqual(new Set(CARRIERS));
      for (const entry of stored) {
        expect("sessionId" in entry ? entry.sessionId : undefined, `${entry.type} ${entry.seq}`).toBe(agent.sessionId);
      }

      const response = await s.api("GET", `/agents/${agent.id}/log`);
      expect(response.status).toBe(200);
      const served = (response.json as { entries: { type: string; sessionId?: unknown }[] }).entries.filter((entry) =>
        CARRIERS.includes(entry.type),
      );
      expect(served.length).toBe(stored.length);
      expect(served.every((entry) => entry.sessionId === agent.sessionId)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
