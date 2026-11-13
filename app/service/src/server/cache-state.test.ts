// Lasting checks (S2c, T13, rows T13-8 and T13-9; silent failures): the cache state an agent's harness reports
// reaches the app on GET /agents (the summary the desktop's ring reads), stays there after the turn that brought it
// ends, and is never stored (D19). The fake agent's `cache` replay step sends it as an extension notification, which
// the fake harness reports as the cache state: so this crosses the acp-client's extension routing, the harness and
// the manager.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ListAgentsResponse } from "@wombat/shared/api";
import { expect, test } from "vitest";

import type { ReplayStep } from "../../test/fake-agent.ts";
import { REPO, TEST_TIMEOUT_MS, WAIT_MS } from "../../test/manager-fixtures.ts";
import { serve, type Served } from "../../test/server-fixtures.ts";

const CACHE = { ttlSeconds: 3600, lastRequestAt: "2026-03-14T09:26:53.000Z" };

const STEPS: ReplayStep[] = [
  { cache: CACHE },
  { send: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The opening hours are updated." } } },
];

/** The agent as GET /agents lists it. */
const listed = async (s: Served, agentId: string) => {
  const response = await s.api("GET", "/agents");
  expect(response.status, response.text).toBe(200);
  return ListAgentsResponse.parse(response.json).agents.find((agent) => agent.id === agentId);
};

/** Starts a fake-replay agent, plays one turn that reports CACHE mid-way, and waits for the turn's end on GET /agents. */
const cachedTurn = async (s: Served): Promise<string> => {
  const started = await s.api("POST", "/agents", { harness: "fake-replay", repo: REPO });
  expect(started.status, started.text).toBe(201);
  const agentId = (started.json as { id: string }).id;
  const sent = await s.api("POST", `/agents/${agentId}/messages`, { text: JSON.stringify(STEPS) });
  expect(sent.status, sent.text).toBe(202);
  const deadline = Date.now() + WAIT_MS;
  while ((await listed(s, agentId))?.state !== "done") {
    if (Date.now() > deadline) throw new Error("timed out waiting for the turn's end on GET /agents");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return agentId;
};

test(
  "T13-9: the cache state is never stored: the stored summary has none while GET /agents shows it",
  async () => {
    const s = await serve();
    const id = await cachedTurn(s);
    expect((await listed(s, id))?.cache, "control: the cache state arrived").toEqual(CACHE);

    const stored = s.store.listAgents().find((agent) => agent.id === id);
    expect(stored, "the stored summary").toBeDefined();
    expect(stored).not.toHaveProperty("cache");
  },
  TEST_TIMEOUT_MS,
);

/** Polls GET /agents until `check` holds for the agent; fails with `what` after WAIT_MS. */
const listedUntil = async (s: Served, agentId: string, what: string, check: (agent: Awaited<ReturnType<typeof listed>>) => boolean) => {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const agent = await listed(s, agentId);
    if (check(agent)) return agent;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} on GET /agents`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

// S2c, T13 (row T13-18; silent): the app refetches GET /agents on an agent_changed event, so a cache change must emit
// one (nothing else in the turn does while it's held); and a cache belongs to a live process: once it ends, GET /agents
// shows none. The turn holds (awaitFile) before and after the cache step, so the event can only be the cache's.
test(
  "T13-18: a cache change emits agent_changed, and once the agent's process ends GET /agents carries no cache",
  async () => {
    const s = await serve();
    const folder = join(s.root, REPO);
    const [first, second] = [join(folder, ".hold-before-cache"), join(folder, ".hold-after-cache")];
    const started = await s.api("POST", "/agents", { harness: "fake-replay", repo: REPO });
    expect(started.status, started.text).toBe(201);
    const id = (started.json as { id: string }).id;
    const steps: ReplayStep[] = [{ awaitFile: first }, { cache: CACHE }, { awaitFile: second }];
    const sent = await s.api("POST", `/agents/${id}/messages`, { text: JSON.stringify(steps) });
    expect(sent.status, sent.text).toBe(202);
    await listedUntil(s, id, "the turn working", (agent) => agent?.state === "working");

    const changes = () => s.committed.filter((event) => (event as { agentId?: string }).agentId === id && event.type === "agent_changed").length;
    const before = changes();
    writeFileSync(first, "");
    await listedUntil(s, id, "the cache state", (agent) => agent?.cache?.ttlSeconds === CACHE.ttlSeconds);
    expect(changes(), "an agent_changed for the cache change").toBeGreaterThan(before);

    writeFileSync(second, "");
    await listedUntil(s, id, "the turn's end", (agent) => agent?.state === "done");
    const stop = await s.api("POST", `/agents/${id}/stop`);
    expect(stop.status, stop.text).toBe(204);
    const ended = await listedUntil(s, id, "the process's end", (agent) => agent?.hasProcess === false);
    expect(ended?.cache ?? undefined, "no cache without a process").toBeUndefined();
  },
  TEST_TIMEOUT_MS,
);
