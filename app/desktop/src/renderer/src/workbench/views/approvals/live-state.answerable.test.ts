// The answer buttons work only when the request takes an answer, the app is connected and no answer is on its way.
import { expect, test } from "vitest";

import { liveState } from "./live-state.ts";

test("a request takes a click only while it takes an answer, connected, with no answer on its way", () => {
  const live = liveState({ turnActive: true }, { state: "waiting", pendingPermissions: [{ requestId: "req-1", at: "2026-01-01T00:00:00.000Z", title: "Run the tests", kind: "execute" }] });
  const request = { requestId: "req-1" };

  expect(live.answerable(request, { connected: true, pending: false })).toBe(true);
  expect(live.answerable(request, { connected: false, pending: false })).toBe(false);
  expect(live.answerable(request, { connected: true, pending: true })).toBe(false);
  expect(live.answerable({ requestId: "req-not-listed" }, { connected: true, pending: false })).toBe(false);
});
