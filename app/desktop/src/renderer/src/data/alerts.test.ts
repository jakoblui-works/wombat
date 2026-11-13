// T8: the alert-driven cache (interface-S4, "Alerts"), against a fake bridge (test/fake-bridge.ts) standing in for
// window.wombat. What would fail silently: an alert reloading a whole log instead of appending, two appends
// duplicating entries, a new store's entries merged into the old store's, and a reconnect that doesn't catch up
// (the event stream never replays).
import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import { fakeService, type FakeService } from "../../../../test/fake-bridge.ts";
import { chunk, toolCall, turnEnded, user } from "../../../../../shared/test/log-entries.ts";
import { proposal, summary } from "../../../../test/summaries.ts";
import { connectAlerts } from "./alerts.ts";
import { keys } from "./keys.ts";
import { type AgentLog, agentLogQuery, agentsQuery, createQueryClient, proposalsQuery } from "./query-client.ts";

const A = "agent-bakery-1";
const B = "agent-bakery-2";

let disconnect: (() => void) | undefined;
const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  disconnect?.();
  disconnect = undefined;
  vi.unstubAllGlobals();
});

/** The fake service behind window.wombat, a fresh QueryClient, and connectAlerts on both; connected at once unless not. */
const setup = ({ connected = true } = {}): { service: FakeService; client: QueryClient } => {
  const service = fakeService();
  vi.stubGlobal("window", { wombat: service.bridge });
  const client = createQueryClient();
  disconnect = connectAlerts(client, service.bridge);
  if (connected) service.connection("connected");
  return { service, client };
};

/** Puts an agent's log in the cache as a first load would have left it. */
const cacheLog = (service: FakeService, client: QueryClient, agentId: string): void => {
  client.setQueryData<AgentLog>(keys.log(agentId), { dbId: service.dbId(), entries: service.log(agentId), truncated: false });
};

const cached = (client: QueryClient, agentId: string): AgentLog | undefined => client.getQueryData<AgentLog>(keys.log(agentId));
const seqs = (log: AgentLog | undefined): number[] => (log?.entries ?? []).map((entry) => entry.seq);
const seqsOf = (list: LogEntry[]): number[] => list.map((entry) => entry.seq);

/** Waits until the fake has no request out and `check` holds. */
const settled = (service: FakeService, check: () => void): Promise<void> =>
  vi.waitFor(() => {
    expect(service.inFlight()).toBe(0);
    check();
  });

const logReads = (service: FakeService, agentId: string): string[] =>
  service
    .requests()
    .filter(({ method, path }) => method === "GET" && path.startsWith(`/agents/${agentId}/log`))
    .map(({ path }) => new URL(path, "http://x").searchParams.get("after") ?? "0");

test("a log alert appends the new entries to that agent's cached log from its cursor, without a full reload", async () => {
  const { service, client } = setup();
  service.append(A, user("Fix the opening hours"), chunk("Looking"));
  service.append(B, user("Check the menu"));
  cacheLog(service, client, A);
  const cursor = Math.max(...seqs(cached(client, A)));

  const added = service.append(A, toolCall("t1", "Edit hours.md"), turnEnded());
  service.append(B, chunk("Menu ok"));
  service.alert("log", A);
  // B's log isn't open: its alert reads nothing.
  service.alert("log", B);

  await settled(service, () => expect(seqs(cached(client, A))).toEqual(seqsOf(service.log(A))));
  expect(cached(client, A)?.entries.slice(-added.length)).toEqual(added);
  expect(logReads(service, A).every((after) => Number(after) >= cursor), `log reads of A: after=${logReads(service, A).join(",")}`).toBe(true);
  expect(logReads(service, B)).toEqual([]);
  expect(cached(client, B)).toBeUndefined();
});

test("alerts that arrive together, or while a read is under way, bring every entry once and in order", async () => {
  const { service, client } = setup();
  service.append(A, user("Fix the hours"));
  cacheLog(service, client, A);

  service.append(A, chunk("One"));
  service.alert("log", A);
  service.alert("log", A);
  // The next entry is stored, and alerted, while a read is on its way back without it.
  await vi.waitFor(() => expect(service.inFlight()).toBeGreaterThan(0));
  service.append(A, chunk("Two"));
  service.alert("log", A);
  service.alert("log", A);

  await settled(service, () => expect(seqs(cached(client, A))).toEqual(seqsOf(service.log(A))));
});

test.each([
  ["the alert names another store than the cached agents", true],
  ["the log read answers from another store", false],
])("a new store's log replaces the cached one, never merges into it: %s", async (_name, agentsCached) => {
  const { service, client } = setup();
  service.append(A, user("old one"), chunk("old two"), chunk("old three"));
  cacheLog(service, client, A);
  if (agentsCached) client.setQueryData(keys.agents, { dbId: service.dbId(), seq: 3, agents: [summary(A)] });
  const oldDb = service.dbId();

  service.newStore("db-2");
  // The new store has more entries than the cursor, so a merge would keep the old store's first three.
  service.append(A, user("new one"), chunk("new two"), chunk("new three"), chunk("new four"), chunk("new five"));
  service.alert("log", A);

  await settled(service, () => {
    const log = cached(client, A);
    // Dropped, or reloaded whole from the new store: never the old store's entries.
    if (log !== undefined) {
      expect(log.dbId).toBe("db-2");
      expect(log.entries).toEqual(service.log(A));
    }
  });
  const agents = client.getQueryData<{ dbId: string }>(keys.agents);
  if (agentsCached && agents !== undefined) expect(agents.dbId).not.toBe(oldDb);
});

test("while reconnecting the cache stays; once connected again, every cached log catches up from its cursor and the agents are refetched", async () => {
  const { service, client } = setup();
  service.append(A, user("Fix the hours"));
  service.append(B, user("Check the menu"));
  cacheLog(service, client, A);
  cacheLog(service, client, B);
  client.setQueryData(keys.agents, { dbId: service.dbId(), seq: 2, agents: [summary(A), summary(B)] });
  const agentsBefore = client.getQueryState(keys.agents)?.dataUpdatedAt ?? 0;
  const before = { a: cached(client, A), b: cached(client, B) };

  service.connection("reconnecting");
  // What happened while the stream was down: no alerts for it, ever.
  service.append(A, chunk("Done"), turnEnded());
  service.append(B, chunk("Menu ok"));
  await settled(service, () => undefined);
  expect({ a: cached(client, A), b: cached(client, B) }, "the cache was cleared while reconnecting").toEqual(before);

  service.connection("connected");
  await settled(service, () => {
    expect(seqs(cached(client, A))).toEqual(seqsOf(service.log(A)));
    expect(seqs(cached(client, B))).toEqual(seqsOf(service.log(B)));
  });
  expect([...logReads(service, A), ...logReads(service, B)]).not.toContain("0");
  const agents = client.getQueryState(keys.agents);
  expect(agents?.isInvalidated === true || (agents?.dataUpdatedAt ?? 0) > agentsBefore, "the agents weren't refetched after the reconnect").toBe(true);
});

// A view reading through the cache with the views' own query options (an observer keeps the query mounted).
const mount = (observer: { subscribe: (listener: () => void) => () => void }): void => {
  unmounts.push(observer.subscribe(() => undefined));
};
const agentsView = (client: QueryClient) => mount(new QueryObserver(client, agentsQuery()));
const logView = (client: QueryClient, agentId: string) => mount(new QueryObserver(client, agentLogQuery(client, agentId)));
const agentsCached = (client: QueryClient): AgentSummary[] | undefined =>
  client.getQueryData<{ agents: AgentSummary[] }>(keys.agents)?.agents;

test("reads that failed before the first connected (the bridge refuses while connecting) are read again once connected", async () => {
  const { service, client } = setup({ connected: false });
  service.refuseWhileDisconnected(true);
  service.append(A, user("Fix the hours"), chunk("Done"));
  agentsView(client);
  logView(client, A);
  await vi.waitFor(() => {
    expect(client.getQueryState(keys.agents)?.status).toBe("error");
    expect(client.getQueryState(keys.log(A))?.status).toBe("error");
  });

  service.connection("connected");

  await settled(service, () => {
    expect(agentsCached(client)?.map((agent) => agent.id)).toEqual([A]);
    expect(seqs(cached(client, A))).toEqual(seqsOf(service.log(A)));
  });
});

test("an agent_changed alert while the first agents read is on its way back still shows the change", async () => {
  const { service, client } = setup();
  service.setAgent(A, { state: "done" });
  agentsView(client);
  // The read's answer is built (state done) and not delivered yet when the agent changes.
  await vi.waitFor(() => expect(service.inFlight()).toBeGreaterThan(0));
  service.setAgent(A, { state: "working" });
  service.alert("agent_changed", A);

  await settled(service, () => expect(agentsCached(client)?.find((agent) => agent.id === A)?.state).toBe("working"));
});

test("a reconnect reads the cached proposals again", async () => {
  const { service, client } = setup();
  mount(new QueryObserver(client, proposalsQuery()));
  await settled(service, () => expect(client.getQueryData(keys.proposals)).toEqual({ proposals: [] }));

  service.connection("reconnecting");
  // Proposed while the stream was down: no alert for it, ever.
  service.addProposal(proposal("prop-1"));
  service.connection("connected");

  await settled(service, () => expect(client.getQueryData(keys.proposals)).toEqual({ proposals: [proposal("prop-1")] }));
});

test("an agents read that comes back from another store resets every query", async () => {
  const { service, client } = setup();
  service.append(A, user("old one"), chunk("old two"));
  agentsView(client);
  await settled(service, () => expect(agentsCached(client)).toHaveLength(1));
  cacheLog(service, client, A);
  // A query no refresh reads again: only a reset clears it.
  client.setQueryData(keys.harnesses, [{ id: "fake-reply", name: "Old store's harness" }]);

  service.connection("reconnecting");
  service.newStore("db-2");
  service.append(A, user("new one"));
  service.connection("connected");

  await settled(service, () => {
    expect(client.getQueryData<{ dbId: string }>(keys.agents)?.dbId).toBe("db-2");
    expect(client.getQueryData(keys.harnesses)).toBeUndefined();
    const log = cached(client, A);
    if (log !== undefined) expect(log.entries).toEqual(service.log(A));
  });
});
