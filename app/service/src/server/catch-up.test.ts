// Lasting check (silent failure): a lost stream loses nothing. Dropping the stream mid-turn and catching up
// through the items route, page by page from the cursor, gives the full history: no gap, no duplicate. The
// dropped stream leaves no listener behind that fails on the next change.
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { serve, type Served } from "../../test/server-fixtures.ts";

type RawItem = { seq: number; type: string; requestId?: string };

const page = async (s: Served, agentId: string, query: string) => {
  const response = await s.api("GET", `/agents/${agentId}/items${query}`);
  expect(response.status, response.text).toBe(200);
  return (response.json as { items: RawItem[] }).items;
};

describe("catch-up after a dropped stream", () => {
  test(
    "items after the cursor plus those before it are the full history, with no gap and no duplicate",
    async () => {
      const s = await serve();
      const stream = await s.stream();
      const created = await s.api("POST", "/agents", { harness: "fake-permission", repo: REPO });
      const { id } = created.json as { id: string };
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Edit the notes" })).status).toBe(202);

      // The app learns of the permission request from an alert, then fetches.
      await stream.until("an alert while the agent waits", () => s.agent(id)?.state === "waiting");
      await stream.until("the alert announcing it", (open) =>
        open.events().some((event) => event.id === String(s.store.currentSeq())),
      );
      const before = await page(s, id, "");
      const request = before.find((item) => item.type === "permission_requested");
      if (!request?.requestId) throw new Error("no permission request before the drop");
      const cursor = before.at(-1)?.seq ?? 0;

      stream.close();
      const answered = await s.api("POST", `/agents/${id}/permissions/${request.requestId}`, { kind: "allow_once" });
      expect(answered.status).toBe(204);
      await s.turnEnded(id);

      const again = await s.stream();
      expect(again.status).toBe(200);
      const after: RawItem[] = [];
      let from = cursor;
      for (;;) {
        const next = await page(s, id, `?after=${from}&limit=2`);
        after.push(...next);
        if (next.length < 2) break;
        from = next.at(-1)?.seq ?? from;
      }

      const full = await page(s, id, "?limit=1000");
      expect([...before, ...after]).toEqual(full);
      const all = [...before, ...after].map((item) => item.seq);
      expect(new Set(all).size).toBe(all.length);
      expect(all.every((seq, index) => index === 0 || seq > (all[index - 1] ?? 0))).toBe(true);
      expect(after.map((item) => item.type)).toEqual(expect.arrayContaining(["permission_answered", "turn_ended"]));
      await waitFor("the store to settle", () => s.agent(id)?.state === "done");
      expect(s.logs.filter((line) => line.event === "listener_failed")).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
