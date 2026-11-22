// Invented agent summaries and proposals for the renderer's tests; the log entries are in shared/test/log-entries.ts.
import type { AgentSummary } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";
import { AGENT, atFor } from "../../shared/test/log-entries.ts";

/** An agent summary as GET /agents lists it. */
export const summary = (id: string, fields: Partial<AgentSummary> = {}): AgentSummary => ({
  id,
  workspace: "ws-bakery0001",
  harness: "fake-reply",
  repo: "bakery-site",
  state: "done",
  sessionId: `session-${id}`,
  capabilities: { loadSession: false },
  startedAt: atFor(0),
  lastActivityAt: atFor(1),
  pendingPermissions: [],
  hasProcess: false,
  ...fields,
});

/** A pending proposal as GET /proposals lists it (an invented edit to an opening-hours page). */
export const proposal = (id: string, agentId = AGENT): Proposal => ({
  id,
  target: "item",
  binder: "pages",
  kind: "update",
  handle: "PAGE-3",
  file: null,
  reason: "Saturday hours changed",
  version: 1,
  editedByMe: false,
  status: "pending",
  agentId,
  at: atFor(2),
});
