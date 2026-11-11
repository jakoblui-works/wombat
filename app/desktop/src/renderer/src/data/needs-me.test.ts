// T8: what "needs me" lists (interface-S4, "needsMe"): every pending permission of a waiting agent, a row for a
// waiting agent without one, newest first, ties by agent id; nothing for an agent that no longer waits.
import { expect, test } from "vitest";

import { atFor, summary } from "../../../../test/log-entries.ts";
import { needsMe } from "./needs-me.ts";

const pending = (requestId: string, at: string, title: string) => ({ requestId, at, title, kind: "edit" as const });

test("rows for waiting agents only, one per pending permission or one for the agent, newest first, ties by agent id", () => {
  const agents = [
    summary("agent-c", { state: "waiting", pendingPermissions: [pending("r1", atFor(10), "Edit notes.txt"), pending("r2", atFor(30), "Run npm test")] }),
    summary("agent-b", { state: "waiting", lastActivityAt: atFor(20) }),
    summary("agent-a", { state: "waiting", lastActivityAt: atFor(30) }),
    // Not waiting: a stale pending row or none, never listed.
    summary("agent-d", { state: "working", pendingPermissions: [pending("r9", atFor(40), "Edit hours.md")] }),
    summary("agent-e", { state: "done", lastActivityAt: atFor(50) }),
  ];
  expect(needsMe(agents)).toEqual([
    { agentId: "agent-a", at: atFor(30) },
    { agentId: "agent-c", requestId: "r2", title: "Run npm test", at: atFor(30) },
    { agentId: "agent-b", at: atFor(20) },
    { agentId: "agent-c", requestId: "r1", title: "Edit notes.txt", at: atFor(10) },
  ]);

  // Answered and back to work: the rows clear with the summary.
  expect(needsMe([summary("agent-c", { state: "working" }), summary("agent-b", { state: "done" })])).toEqual([]);
  expect(needsMe([])).toEqual([]);
});
