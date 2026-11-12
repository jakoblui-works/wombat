import { expect, test } from "vitest";

import { CONNECTION_STATES, type Connection, isSettled, NO_RESTART, type RestartAttempt, type RestartEvent, restartAttempt, showsBanner } from "./connection-state.ts";

const STATES = Object.keys(CONNECTION_STATES) as Connection[];

test("the first connecting shows no banner", () => {
  expect(showsBanner("connecting", false)).toBe(false);
});

test("failed and incompatible show the banner even before any connect", () => {
  expect(showsBanner("failed", false)).toBe(true);
  expect(showsBanner("incompatible", false)).toBe(true);
});

test("connected never shows it", () => {
  expect(showsBanner("connected", false)).toBe(false);
  expect(showsBanner("connected", true)).toBe(false);
});

test("after a connect, every other state shows it", () => {
  for (const state of STATES.filter((s) => s !== "connected")) expect(showsBanner(state, true), state).toBe(true);
});

test("each state has its own label", () => {
  expect(new Set(STATES.map((state) => CONNECTION_STATES[state].label)).size).toBe(STATES.length);
});

test("only failed and incompatible are settled: no retry is coming", () => {
  expect(STATES.filter(isSettled).sort()).toEqual(["failed", "incompatible"]);
});

const run = (...events: RestartEvent[]): RestartAttempt => events.reduce(restartAttempt, NO_RESTART);

test("a rejected restart's error survives the connection changing state afterwards", () => {
  const attempt = run({ type: "start" }, { type: "connection", state: "connecting" }, { type: "rejected", error: "no" }, { type: "connection", state: "failed" });
  expect(attempt).toEqual({ pending: false, error: "no" });
});

test("the error is cleared once connected", () => {
  expect(run({ type: "start" }, { type: "rejected", error: "no" }, { type: "connection", state: "connected" }).error).toBeUndefined();
});

test("a new attempt clears the previous error", () => {
  expect(run({ type: "start" }, { type: "rejected", error: "no" }, { type: "start" })).toEqual({ pending: true });
});

test("an attempt stays pending across state changes until it settles", () => {
  const states: Connection[] = ["failed", "connecting", "reconnecting", "connected"];
  const during = run({ type: "start" }, ...states.map((state): RestartEvent => ({ type: "connection", state })));
  expect(during.pending).toBe(true);
  expect(restartAttempt(during, { type: "settled" }).pending).toBe(false);
});
