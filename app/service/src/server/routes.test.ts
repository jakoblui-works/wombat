// The contract's routes over real HTTP with the fake agents: statuses, response shapes, the error mapping,
// strict bodies and queries, the body size cap and the items route's cursor and limits.
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { API_VERSION } from "@wombat/shared";
import {
  AgentSummary,
  ListAgentsResponse,
  ListHarnessesResponse,
  ListItemsResponse,
  VersionResponse,
  type Item,
} from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { expectError, serve, type Served } from "../../test/server-fixtures.ts";

/** Starts an agent over HTTP and returns its summary. */
const startAgent = async (s: Served, harness: string) => {
  const response = await s.api("POST", "/agents", { harness, repo: REPO });
  expect(response.status, response.text).toBe(201);
  return AgentSummary.parse(response.json);
};

/** The items route's raw items (unknown fields kept), with a query string. */
const rawItems = async (s: Served, agentId: string, query = "") => {
  const response = await s.api("GET", `/agents/${agentId}/items${query}`);
  expect(response.status, response.text).toBe(200);
  return response.json as { dbId: string; seq: number; items: { seq: number; type: string }[]; truncated: boolean };
};

const seqs = (items: { seq: number }[]) => items.map((item) => item.seq);

const waitForState = (s: Served, agentId: string, state: AgentSummary["state"]) =>
  waitFor(`agent ${agentId} to be ${state}`, () => s.agent(agentId)?.state === state);

describe("routes", () => {
  test(
    "version and harnesses answer per the contract; POST /agents answers 201 with the summary and GET /agents lists it with the store's dbId and seq",
    async () => {
      const s = await serve();
      const version = await s.api("GET", "/version");
      expect(version.status).toBe(200);
      expect(VersionResponse.parse(version.json).apiVersion).toBe(API_VERSION);

      const harnesses = await s.api("GET", "/harnesses");
      expect(harnesses.status).toBe(200);
      expect(
        ListHarnessesResponse.parse(harnesses.json)
          .map((harness) => harness.id)
          .sort(),
      ).toEqual([...s.harnessIds].sort());

      const agent = await startAgent(s, "fake-reply");
      expect(agent).toMatchObject({ harness: "fake-reply", repo: REPO });

      const listed = await s.api("GET", "/agents");
      expect(listed.status).toBe(200);
      const body = ListAgentsResponse.parse(listed.json);
      expect(body.dbId).toBe(s.store.dbId);
      expect(body.seq).toBe(s.store.currentSeq());
      expect(body.agents.map((each) => each.id)).toEqual([agent.id]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a message answers 202 with its seq, and a repeat of its commandId, during the turn and after it, answers 202 with the same seq and reaches the agent once",
    async () => {
      const s = await serve();
      const { id } = await startAgent(s, "fake-hang");
      const message = { text: "Wait for me", commandId: "cmd_retry_1" };

      const first = await s.api("POST", `/agents/${id}/messages`, message);
      expect(first.status, first.text).toBe(202);
      const { seq } = first.json as { seq: number };
      expect(Number.isInteger(seq)).toBe(true);

      const during = await s.api("POST", `/agents/${id}/messages`, message);
      expect(during.status, during.text).toBe(202);
      expect(during.json).toEqual({ seq });

      expect((await s.api("POST", `/agents/${id}/cancel`)).status).toBe(202);
      await s.turnEnded(id);
      const after = await s.api("POST", `/agents/${id}/messages`, message);
      expect(after.status, after.text).toBe(202);
      expect(after.json).toEqual({ seq });

      const { items } = await rawItems(s, id);
      expect(items.filter((item) => item.type === "user_message")).toHaveLength(1);
      expect(items.filter((item) => item.type === "turn_ended")).toHaveLength(1);
      expect(s.agent(id)?.state).toBe("done");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a permission answer answers 204 and the turn goes on, a second answer gets 404; cancel answers 202 and ends a hanging turn as cancelled",
    async () => {
      const s = await serve();
      const permission = await startAgent(s, "fake-permission");
      expect((await s.api("POST", `/agents/${permission.id}/messages`, { text: "Edit the notes" })).status).toBe(202);
      await waitForState(s, permission.id, "waiting");
      const request = (await rawItems(s, permission.id)).items.find((item) => item.type === "permission_requested") as
        | Extract<Item, { type: "permission_requested" }>
        | undefined;
      if (!request) throw new Error("no permission request in the items");

      const answered = await s.api("POST", `/agents/${permission.id}/permissions/${request.requestId}`, {
        kind: "allow_once",
      });
      expect(answered.status, answered.text).toBe(204);
      expect(answered.text).toBe("");
      expect((await s.turnEnded(permission.id)).stopReason).toBe("end_turn");
      const updates = s.items(permission.id).flatMap((item) => (item.type === "session_update" ? [item.update] : []));
      expect(updates.some((update) => update.sessionUpdate === "tool_call_update" && update.status === "completed")).toBe(true);

      const again = await s.api("POST", `/agents/${permission.id}/permissions/${request.requestId}`, {
        kind: "allow_once",
      });
      expectError(again, 404, "not_found", "a second answer");

      const hang = await startAgent(s, "fake-hang");
      expect((await s.api("POST", `/agents/${hang.id}/messages`, { text: "Wait for me" })).status).toBe(202);
      const cancelled = await s.api("POST", `/agents/${hang.id}/cancel`);
      expect(cancelled.status, cancelled.text).toBe(202);
      expect((await s.turnEnded(hang.id)).stopReason).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "stop answers 204 and keeps the history; DELETE answers 204 and removes the agent and its items; a second DELETE gets 404",
    async () => {
      const s = await serve();
      const { id } = await startAgent(s, "fake-reply");
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Say hello" })).status).toBe(202);
      await s.turnEnded(id);
      const history = (await rawItems(s, id)).items;

      const stopped = await s.api("POST", `/agents/${id}/stop`);
      expect(stopped.status, stopped.text).toBe(204);
      const agents = ListAgentsResponse.parse((await s.api("GET", "/agents")).json).agents;
      expect(agents.find((agent) => agent.id === id)?.state).toBe("stopped");
      expect((await rawItems(s, id)).items).toEqual(history);
      expect((await s.api("POST", `/agents/${id}/stop`)).status, "a second stop").toBe(204);

      const deleted = await s.api("DELETE", `/agents/${id}`);
      expect(deleted.status, deleted.text).toBe(204);
      expect(ListAgentsResponse.parse((await s.api("GET", "/agents")).json).agents).toEqual([]);
      expectError(await s.api("GET", `/agents/${id}/items`), 404, "not_found", "items of a deleted agent");
      expectError(await s.api("DELETE", `/agents/${id}`), 404, "not_found", "a second DELETE");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "each agent error answers with its HTTP status and an ErrorBody carrying its code",
    async () => {
      const s = await serve();
      const unknown = "agt_does_not_exist";
      for (const [method, path, body] of [
        ["GET", `/agents/${unknown}/items`, undefined],
        ["POST", `/agents/${unknown}/messages`, { text: "Hello" }],
        ["POST", `/agents/${unknown}/permissions/req_1`, { kind: "allow_once" }],
        ["POST", `/agents/${unknown}/cancel`, undefined],
        ["POST", `/agents/${unknown}/stop`, undefined],
        ["DELETE", `/agents/${unknown}`, undefined],
      ] as const) {
        expectError(await s.api(method, path, body), 404, "not_found", `${method} ${path}`);
      }

      const outside = join(dirname(s.root), "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(s.root, "escape"));
      for (const [body, code] of [
        [{ harness: "no-such-harness", repo: REPO }, "unknown_harness"],
        [{ harness: "fake-reply", repo: "missing" }, "repo_not_found"],
        [{ harness: "fake-reply", repo: "escape" }, "repo_outside_workspace"],
      ] as const) {
        expectError(await s.api("POST", "/agents", body), 422, code, JSON.stringify(body));
      }
      expect(s.pids(), "nothing was spawned").toEqual([]);

      const { id } = await startAgent(s, "fake-hang");
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Wait for me" })).status).toBe(202);
      expectError(await s.api("POST", `/agents/${id}/messages`, { text: "And this" }), 409, "busy", "a second message");
      expect((await s.api("POST", `/agents/${id}/stop`)).status).toBe(204);
      expectError(await s.api("POST", `/agents/${id}/messages`, { text: "Hello?" }), 409, "not_running", "a stopped agent");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "bodies and queries that break the contract get 400, a body over 1 MiB gets 413, each with an ErrorBody, and nothing changes",
    async () => {
      const s = await serve();
      const { id } = await startAgent(s, "fake-permission");
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Edit the notes" })).status).toBe(202);
      await waitForState(s, id, "waiting");
      const request = s.items(id).find((item) => item.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      const answer = `/agents/${id}/permissions/${request.requestId}`;
      const messages = `/agents/${id}/messages`;
      const items = `/agents/${id}/items`;
      const seq = s.store.currentSeq();
      const pids = s.pids().length;

      const bad: [string, string, unknown][] = [
        ["POST", "/agents", "{not json"],
        ["POST", "/agents", undefined],
        ["POST", "/agents", { harness: "fake-reply", repo: REPO, command: "rm -rf /" }],
        ["POST", "/agents", { harness: "fake-reply" }],
        ["POST", "/agents", { harness: "fake-reply", repo: "../elsewhere" }],
        ["POST", "/agents", ["fake-reply", REPO]],
        ["POST", messages, { text: "" }],
        ["POST", messages, { text: "Hello", extra: true }],
        ["POST", messages, { text: "Hello", commandId: "not a valid id!" }],
        ["POST", messages, "{not json"],
        ["POST", messages, undefined],
        ["POST", answer, { kind: "allow" }],
        ["POST", answer, { optionId: "allow" }],
        ["POST", answer, {}],
        ["POST", answer, "{not json"],
        ["GET", `${items}?after=1&after=2`, undefined],
        ["GET", `${items}?limit=1&limit=2`, undefined],
        ["GET", `${items}?since=1`, undefined],
        ["GET", `${items}?limit=0`, undefined],
        ["GET", `${items}?limit=1001`, undefined],
        ["GET", `${items}?after=-1`, undefined],
        ["GET", `${items}?after=`, undefined],
        ["GET", `${items}?limit=`, undefined],
      ];
      for (const [method, path, body] of bad) {
        expectError(await s.api(method, path, body), 400, "invalid_request", `${method} ${path} ${JSON.stringify(body)}`);
      }

      const huge = { text: "x".repeat(1024 * 1024 + 1) };
      expectError(await s.api("POST", messages, huge), 413, "payload_too_large", "a message over 1 MiB");

      expect(s.store.currentSeq()).toBe(seq);
      expect(s.pids()).toHaveLength(pids);
      expect(s.agent(id)?.state).toBe("waiting");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the items route returns the items after the cursor, oldest first, at most the limit or the default without one, and passes truncated through",
    async () => {
      const s = await serve({ defaultItemsLimit: 2 });
      const { id } = await startAgent(s, "fake-reply");
      expect((await s.api("POST", `/agents/${id}/messages`, { text: "Say hello" })).status).toBe(202);
      await s.turnEnded(id);

      const all = await rawItems(s, id, "?limit=1000");
      expect(ListItemsResponse.parse(all).dbId).toBe(s.store.dbId);
      expect(all.seq).toBe(s.store.currentSeq());
      expect(all.truncated).toBe(false);
      expect(all.items).toEqual(s.store.items(id).items);
      const allSeqs = seqs(all.items);
      expect(allSeqs.length).toBeGreaterThanOrEqual(4);
      expect([...allSeqs].sort((a, b) => a - b)).toEqual(allSeqs);

      const cursor = allSeqs[1] ?? 0;
      expect((await rawItems(s, id, `?after=${cursor}&limit=1000`)).items).toEqual(
        all.items.filter((item) => item.seq > cursor),
      );
      expect(seqs((await rawItems(s, id, `?after=${cursor}&limit=1`)).items)).toEqual(
        allSeqs.filter((seq) => seq > cursor).slice(0, 1),
      );
      expect(seqs((await rawItems(s, id)).items), "the default limit").toEqual(allSeqs.slice(0, 2));
      expect(seqs((await rawItems(s, id, "?limit=3")).items), "a limit above the default").toEqual(allSeqs.slice(0, 3));
      expect((await rawItems(s, id, `?after=${allSeqs.at(-1) ?? 0}`)).items).toEqual([]);

      const capped = await serve({ storeOptions: { maxItemBytesPerAgent: 1 } });
      const small = await startAgent(capped, "fake-reply");
      expect((await capped.api("POST", `/agents/${small.id}/messages`, { text: "Say hello" })).status).toBe(202);
      await capped.turnEnded(small.id);
      const dropped = await rawItems(capped, small.id);
      expect(dropped.truncated).toBe(true);
      expect(dropped.items).toEqual(capped.store.items(small.id).items);
    },
    TEST_TIMEOUT_MS,
  );
});
