// AgentSummary.activity is read leniently: a newer service's activity kind must not make the agent list unreadable.
import { expect, test } from "vitest";

import { AgentSummary } from "./api.ts";

const workingAgent = {
  id: "agt_2b9d41",
  harness: "claude-code",
  repo: "site-web",
  state: "working",
  sessionId: "sess_01JC2R7K4N",
  capabilities: { loadSession: true },
  startedAt: "2026-11-04T09:15:00.000Z",
  lastActivityAt: "2026-11-04T09:21:42.512Z",
};

test("an activity of a kind this app doesn't know reads as null, and the rest of the summary is kept", () => {
  const parsed = AgentSummary.parse({ ...workingAgent, activity: { kind: "compacting", title: "Context" } });
  expect(parsed.activity).toBeNull();
  expect(parsed.state).toBe("working");
});

test("a summary from before the field parses without one", () => {
  expect(AgentSummary.parse(workingAgent)).not.toHaveProperty("activity");
});
