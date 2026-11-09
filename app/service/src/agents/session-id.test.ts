// The ACP sessionId each session update and permission request arrived with is stored in the item's body and
// served by the items route, so items from other sessions (sub-agents, later) need no store migration.
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";

const CARRIERS = ["session_update", "permission_requested", "permission_answered"];

describe("sessionId on items", () => {
  test(
    "every session update and permission item stores the agent's ACP sessionId, and the items route serves it",
    async () => {
      const s = await serve();
      const agent = await s.manager.start("fake-permission", REPO);
      await s.manager.send(agent.id, { text: "Edit the notes" });
      await waitFor("a pending permission", () => s.agent(agent.id)?.state === "waiting");
      const request = s.items(agent.id).find((item) => item.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      s.manager.answer(agent.id, request.requestId, "allow_once");
      await s.turnEnded(agent.id);
      expect(agent.sessionId).not.toBe("");

      const stored = s.items(agent.id).filter((item) => CARRIERS.includes(item.type));
      expect(new Set(stored.map((item) => item.type))).toEqual(new Set(CARRIERS));
      for (const item of stored) {
        expect("sessionId" in item ? item.sessionId : undefined, `${item.type} ${item.seq}`).toBe(agent.sessionId);
      }

      const response = await s.api("GET", `/agents/${agent.id}/items`);
      expect(response.status).toBe(200);
      const served = (response.json as { items: { type: string; sessionId?: unknown }[] }).items.filter((item) =>
        CARRIERS.includes(item.type),
      );
      expect(served.length).toBe(stored.length);
      expect(served.every((item) => item.sessionId === agent.sessionId)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
