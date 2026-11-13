import { expect, test } from "vitest";

import { CONNECTION_STATES, type Connection, NO_RESTART, type RestartAttempt, type RestartEvent, restartAttempt, showsBanner } from "./connection-state.ts";

const STATES = Object.keys(CONNECTION_STATES) as Connection[];

test("after a connect, every other state shows it", () => {
  for (const state of STATES.filter((s) => s !== "connected")) expect(showsBanner(state, true), state).toBe(true);
});

const run = (...events: RestartEvent[]): RestartAttempt => events.reduce(restartAttempt, NO_RESTART);

test("a rejected restart's error survives the connection changing state afterwards", () => {
  const attempt = run({ type: "start" }, { type: "connection", state: "connecting" }, { type: "rejected", error: "no" }, { type: "connection", state: "failed" });
  expect(attempt).toEqual({ pending: false, error: "no" });
});
