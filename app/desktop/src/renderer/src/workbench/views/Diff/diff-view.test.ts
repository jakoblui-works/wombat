// S7 T14 (silent failure): which diff tabs apply, at the registry, as the live prune and the restore ask it.
// - While the app runs, a diff tab stays while its agent exists, so an answered request's tab keeps showing its
//   outcome until the user closes it (`isKnown`, the live prune's rule, through the view's `resolves`).
// - At the next start, a diff tab comes back only while its request is still pending (`isRestorable`, the restore's
//   rule, through the view's `restores`): answered requests' tabs aren't restored. Other tabs restore as they live.
// - A deleted agent's diff tab goes either way.
import { expect, test } from "vitest";

import type { AgentSummary } from "@wombat/shared/api";

import { atFor } from "../../../../../../../shared/test/log-entries.ts";
import { summary } from "../../../../../../test/summaries.ts";
import "../../activities.ts";
import { getView, isKnown, isRestorable } from "../../registry.ts";

const pending = (requestId: string, at: string): AgentSummary["pendingPermissions"][number] => ({ requestId, at, title: "Edit hours.md", kind: "edit" });

const agents = [summary("agent-1", { state: "waiting", pendingPermissions: [pending("req-open", atFor(10))] })];
const open = { agentId: "agent-1", requestId: "req-open" };
const answered = { agentId: "agent-1", requestId: "req-answered" };
const agentGone = { agentId: "agent-deleted", requestId: "req-open" };

test("live: a diff tab stays while its agent exists, answered or not, and goes with the agent", () => {
  expect(getView("diff"), 'no view "diff" registered').toBeDefined();
  const known = isKnown({ agents });
  expect(known("diff", open)).toBe(true);
  expect(known("diff", answered)).toBe(true);
  expect(known("diff", agentGone)).toBe(false);
});

test("restore: a diff tab comes back only while its request is pending; a chat tab as it lives", () => {
  expect(getView("diff"), 'no view "diff" registered').toBeDefined();
  const restorable = isRestorable({ agents });
  expect(restorable("diff", open)).toBe(true);
  expect(restorable("diff", answered)).toBe(false);
  expect(restorable("diff", agentGone)).toBe(false);
  expect(restorable("chat", { agentId: "agent-1" })).toBe(true);
  expect(restorable("chat", { agentId: "agent-deleted" })).toBe(false);
  expect(restorable("no-such-view", {})).toBe(false);
});
