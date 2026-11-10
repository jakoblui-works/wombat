// The alert stream: one SSE event per committed change, seq as its id, from the moment the response headers
// arrive (the app opens the stream, then fetches); a heartbeat comment line while idle; close() ends open streams.
import { parseAlert } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor, WAIT_MS } from "../../test/manager-fixtures.ts";
import { rawRequest, serve, type Stream } from "../../test/server-fixtures.ts";

const alertsOf = (stream: Stream) => stream.events().filter((event) => event.data !== "");

describe("GET /events", () => {
  test(
    "sends one alert per committed change, with its seq as the SSE id, from the moment it is opened, and replays nothing",
    async () => {
      const s = await serve();
      await s.manager.start("fake-reply", REPO);
      const openedAt = s.store.currentSeq();

      const stream = await s.stream();
      expect(stream.status).toBe(200);
      expect(String(stream.headers["content-type"])).toMatch(/^text\/event-stream/);

      const created = await s.api("POST", "/agents", { harness: "fake-reply", repo: REPO });
      const { id } = created.json as { id: string };
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Say hello" })).status).toBe(202);
      await s.turnEnded(id);
      expect((await s.api("POST", `/agents/${id}/stop`)).status).toBe(204);

      // Opened after all of the above, asking for a replay from the start: it gets only what comes next.
      const late = await s.stream({ headers: { "last-event-id": "0" } });
      expect((await s.api("DELETE", `/agents/${id}`)).status).toBe(204);

      const expected = s.committed.filter((event) => event.seq > openedAt);
      expect(expected.map((event) => event.type)).toEqual(
        expect.arrayContaining(["agent_added", "agent_changed", "log", "agent_removed"]),
      );
      await stream.until("an alert for every committed change", (open) => alertsOf(open).length >= expected.length);
      const removal = expected.at(-1);
      await late.until("the removal alert on the late stream", (open) => alertsOf(open).length >= 1);

      for (const [open, events] of [
        [stream, expected],
        [late, removal ? [removal] : []],
      ] as const) {
        const alerts = alertsOf(open);
        expect(alerts.map((event) => event.id)).toEqual(events.map((event) => String(event.seq)));
        expect(alerts.every((event) => event.event === undefined)).toBe(true);
        expect(alerts.map((event) => parseAlert(JSON.parse(event.data)))).toEqual(
          events.map((event) =>
            event.type === "proposal"
              ? { seq: event.seq, dbId: s.store.dbId, type: event.type, proposalId: event.proposalId }
              : { seq: event.seq, dbId: s.store.dbId, type: event.type, agentId: event.agentId },
          ),
        );
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "sends a heartbeat comment line while idle",
    async () => {
      const s = await serve({ heartbeatMs: 50 });
      const stream = await s.stream();
      expect(stream.status).toBe(200);
      await stream.until("two heartbeats", (open) => open.comments().filter((comment) => comment === "ping").length >= 2);
      expect(alertsOf(stream)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "close() resolves while a stream is still open, and ends it",
    async () => {
      const s = await serve();
      const stream = await s.stream();
      expect(stream.status).toBe(200);
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        s.close().then(() => "closed"),
        new Promise((resolve) => (timer = setTimeout(() => resolve("still open"), WAIT_MS))),
      ]);
      clearTimeout(timer);
      expect(outcome).toBe("closed");
      await stream.until("the stream to end", (open) => open.ended());
      await expect(rawRequest(s.port, { path: "/version" })).rejects.toThrow();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a dropped stream leaves no subscription behind",
    async () => {
      const s = await serve();
      const baseline = s.subscriptions();
      const stream = await s.stream();
      expect(stream.status).toBe(200);
      expect(s.subscriptions(), "control: the open stream is subscribed").toBe(baseline + 1);
      stream.close();
      await waitFor("the dropped stream to unsubscribe", () => s.subscriptions() === baseline);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "HEAD /events is refused and leaves no subscription behind",
    async () => {
      const s = await serve();
      const baseline = s.subscriptions();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        statuses.push((await s.api("HEAD", "/events")).status);
      }
      await waitFor("no subscription left by HEAD", () => s.subscriptions() === baseline);
      // A HEAD response has no body, so only the status can say why.
      expect(statuses).toEqual([405, 405, 405]);
    },
    TEST_TIMEOUT_MS,
  );
});
