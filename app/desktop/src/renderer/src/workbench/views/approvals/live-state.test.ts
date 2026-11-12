// The chat's live state. The log says what began; the agent's summary only ends things: a finished agent's turn
// isn't running and its open requests read cancelled. A request the summary doesn't list yet stays open with its
// buttons waiting, never "Cancelled"; one it lists takes an answer; the log's answer always stands.
import type { AgentSummary } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { liveState } from "./live-state.ts";

const pending = (...ids: string[]): AgentSummary["pendingPermissions"] =>
  ids.map((requestId) => ({ requestId, at: "2026-01-01T00:00:00.000Z", title: "Run the tests", kind: "execute" }));

test("a failed turn (state error, no turn_ended in the log) isn't running, and its open request reads cancelled", () => {
  const live = liveState({ turnActive: true }, { state: "error", pendingPermissions: [] });
  expect(live.turnActive).toBe(false);
  expect(live.answerOf({ requestId: "req-1" })).toBe("cancelled");
  expect(live.canAnswer({ requestId: "req-1" })).toBe(false);
});

test("a stopped or done agent's turn isn't running", () => {
  for (const state of ["stopped", "done"] as const) expect(liveState({ turnActive: true }, { state, pendingPermissions: [] }).turnActive, state).toBe(false);
});

test("while the agent works or waits the log decides the turn", () => {
  expect(liveState({ turnActive: true }, { state: "working", pendingPermissions: [] }).turnActive).toBe(true);
  expect(liveState({ turnActive: false }, { state: "working", pendingPermissions: [] }).turnActive).toBe(false);
});

test("a listed request takes an answer; one not listed yet stays open with its buttons waiting; a logged answer stands", () => {
  const live = liveState({ turnActive: true }, { state: "waiting", pendingPermissions: pending("req-listed") });
  expect(live.answerOf({ requestId: "req-listed" })).toBeUndefined();
  expect(live.canAnswer({ requestId: "req-listed" })).toBe(true);
  expect(live.answerOf({ requestId: "req-new" }), "not listed yet: no Cancelled flash").toBeUndefined();
  expect(live.canAnswer({ requestId: "req-new" })).toBe(false);
  expect(live.answerOf({ requestId: "req-new", answer: "allow_once" })).toBe("allow_once");
  expect(live.canAnswer({ requestId: "req-listed", answer: "allow_once" })).toBe(false);
});

test("without the agent's summary the log is all there is", () => {
  const live = liveState({ turnActive: true }, undefined);
  expect(live.turnActive).toBe(true);
  expect(live.answerOf({ requestId: "req-1" })).toBeUndefined();
  expect(live.canAnswer({ requestId: "req-1" })).toBe(true);
});
