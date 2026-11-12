// Main's connection to the service: the states the page sees and the alerts it gets. Each test runs against a service
// in this process (test/alert-service.ts) in a temp sandbox, with short retry timings.
import type { Alert } from "@wombat/shared/api";
import { API_VERSION } from "@wombat/shared";
import path from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

import { alertService } from "../../test/alert-service.ts";
import { inProcessService, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import type { ConnectionState } from "../shared/bridge.ts";
import { serviceConnection, type ConnectionTiming } from "./service-connection.ts";
import { startService } from "./service-start.ts";

const WAIT = { timeout: 5_000, interval: 10 };

const connect = (sandbox: ServiceSandbox, timing: Partial<ConnectionTiming> = {}) => {
  const states: ConnectionState[] = [];
  const alerts: Alert[] = [];
  const connection = serviceConnection({
    discoveryFile: () => sandbox.discoveryPath,
    onState: ({ state }) => states.push(state),
    onAlert: (alert) => alerts.push(alert),
    timing: { firstRetryMs: 10, maxRetryMs: 40, failAfterMs: 10_000, ...timing },
    log: () => undefined,
  });
  onTestFinished(() => connection.close());
  const latest = () => states.at(-1)?.state;
  const reached = (state: ConnectionState["state"]) =>
    vi.waitFor(() => {
      expect(latest()).toBe(state);
    }, WAIT);
  return { connection, states, alerts, latest, reached };
};

const agentAlert = (seq: number): Alert => ({ seq, dbId: "db-1", type: "agent_changed", agentId: "agent-1" });

test("known alerts reach the page; an alert type this app doesn't know is dropped", async () => {
  const sandbox = serviceSandbox();
  const service = await alertService(sandbox);
  const { connection, alerts, reached } = connect(sandbox);
  void connection.reconnect(() => Promise.resolve());
  await reached("connected");

  service.send({ seq: 1, dbId: "db-1", type: "agent_renamed", agentId: "agent-1" });
  service.send(agentAlert(2));
  await vi.waitFor(() => {
    expect(alerts.length).toBeGreaterThan(0);
  }, WAIT);
  expect(alerts).toEqual([agentAlert(2)]);
});

test("a stream that sends more than an alert's worth without ending the event is dropped", async () => {
  const sandbox = serviceSandbox();
  const service = await alertService(sandbox);
  const { connection, states, reached } = connect(sandbox);
  void connection.reconnect(() => Promise.resolve());
  await reached("connected");

  service.sendRaw(`data: "${"a".repeat(1024 * 1024)}`);
  await vi.waitFor(() => {
    expect(states.map(({ state }) => state)).toContain("reconnecting");
  }, WAIT);
});

test("a service with another API version is incompatible, and the message names both versions", async () => {
  const sandbox = serviceSandbox();
  const other = API_VERSION + 1;
  const service = await alertService(sandbox, { apiVersion: other });
  const { connection, states } = connect(sandbox);
  await connection.reconnect(() => Promise.resolve());

  const last = states.at(-1);
  expect(last?.state).toBe("incompatible");
  expect(last?.message).toContain(String(other));
  expect(last?.message).toContain(String(API_VERSION));
  expect(service.streams(), "it opened the alert stream of an incompatible service").toBe(0);
});

test("a service that's gone shows reconnecting, then failed once it stays gone; restart starts one and connects", async () => {
  const sandbox = serviceSandbox();
  const first = await alertService(sandbox);
  const { connection, reached } = connect(sandbox, { failAfterMs: 200 });
  void connection.reconnect(() => Promise.resolve());
  await reached("connected");

  await first.kill();
  await reached("reconnecting");
  await reached("failed");

  let second: Awaited<ReturnType<typeof alertService>> | undefined;
  await connection.reconnect(async () => {
    second = await alertService(sandbox);
  });
  expect(connection.current().state.state).toBe("connected");
  expect(second?.streams()).toBe(1);
  // Requests go to the new service.
  expect((await connection.request("GET", "/version", undefined)).status).toBe(200);
});

test("a start that fails is the failed state, its message naming no path outside the workspace", async () => {
  const sandbox = serviceSandbox();
  const { connection, states } = connect(sandbox);
  const entry = path.join(sandbox.base, "no-such-entry.ts");
  await connection.reconnect(() => startService({ env: sandbox.env, entry, workspace: sandbox.workspace("main") }));

  const last = states.at(-1);
  expect(last?.state).toBe("failed");
  expect(last?.message).toContain("no-such-entry.ts");
  expect(last?.message).not.toContain(sandbox.base);
});

test("a start that finds a service from before this app (no workspace in its file) is incompatible, saying it predates the app", async () => {
  const sandbox = serviceSandbox();
  await inProcessService(sandbox, undefined);
  const { connection, states } = connect(sandbox);
  // As a start that finds the lock held: it exits 0 and leaves the old service running.
  await connection.reconnect(() => startService({ env: sandbox.env, entry: sandbox.exitingEntry(), workspace: sandbox.workspace("main") }));

  const last = states.at(-1);
  expect(last?.state).toBe("incompatible");
  expect(last?.message).toContain("predates this app");
  expect(last?.message).toContain("Restart");
});

test("a service that keeps dropping the stream right after opening it is retried with growing waits, then failed", async () => {
  const sandbox = serviceSandbox();
  const service = await alertService(sandbox, { closeStream: true });
  const { connection, states } = connect(sandbox, { firstRetryMs: 5, maxRetryMs: 40, failAfterMs: 400 });
  void connection.reconnect(() => Promise.resolve());
  await vi.waitFor(() => {
    expect(states.at(-1)?.state).toBe("failed");
  }, WAIT);
  connection.close();

  const tries = service.versionTries();
  const gaps = tries.slice(1).map((at, i) => at - (tries[i] ?? at));
  // Back-to-back reconnects would make hundreds of tries in 400 ms; backing off to 40 ms makes a dozen or so.
  expect(tries.length, "it reconnected without waiting").toBeLessThan(40);
  expect(Math.max(...gaps), "the waits never grew").toBeGreaterThanOrEqual(38);
});

test("until it connects it keeps trying, waiting longer between tries but never past the cap", async () => {
  const sandbox = serviceSandbox();
  // Answers /version but refuses the stream, so every try reaches it and can be timed.
  const service = await alertService(sandbox, { refuseStream: true });
  const maxRetryMs = 60;
  const { connection } = connect(sandbox, { firstRetryMs: 5, maxRetryMs });
  void connection.reconnect(() => Promise.resolve());

  await vi.waitFor(() => {
    expect(service.versionTries().length).toBeGreaterThanOrEqual(10);
  }, WAIT);
  const tries = service.versionTries();
  const gaps = tries.slice(1).map((at, i) => at - (tries[i] ?? at));
  // From 5 ms the waits grow to the cap (a timer never fires early, give or take a millisecond).
  expect(gaps.at(-1), "the waits don't grow").toBeGreaterThanOrEqual(maxRetryMs - 2);
  // Slack for a loaded machine; an unbounded doubling would be far past it by the tenth try.
  expect(Math.max(...gaps), "a wait went past the cap").toBeLessThan(maxRetryMs * 4);
  expect(connection.current().state.state).toBe("connecting");
});

test("a shutdown shows failed at once, with a message saying to restart; restart connects again", async () => {
  const sandbox = serviceSandbox();
  const first = await alertService(sandbox);
  const { connection, states } = connect(sandbox);
  void connection.reconnect(() => Promise.resolve());
  await vi.waitFor(() => {
    expect(first.streams()).toBe(1);
  }, WAIT);

  await connection.shutdown(() => first.kill());
  const last = states.at(-1);
  expect(last?.state).toBe("failed");
  expect(last?.message).toContain("Restart");
  expect(states.map(({ state }) => state), "it tried to reconnect to the stopped service").not.toContain("reconnecting");

  await connection.reconnect(() => alertService(sandbox));
  expect(connection.current().state.state).toBe("connected");
});

test("a shutdown whose stop fails connects to the still-running service again and rejects", async () => {
  const sandbox = serviceSandbox();
  const service = await alertService(sandbox);
  const { connection, states, reached } = connect(sandbox);
  void connection.reconnect(() => Promise.resolve());
  await reached("connected");

  await expect(connection.shutdown(() => Promise.reject(new Error("the service refused to stop")))).rejects.toThrow("refused to stop");
  expect(states).toContainEqual({ state: "connecting", message: "Stopping the service…" });
  await reached("connected");
  await vi.waitFor(() => {
    expect(service.streams()).toBe(1);
  }, WAIT);
});
