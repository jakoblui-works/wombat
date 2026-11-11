// Invented log entries and agent summaries for the renderer's data tests (T8), built through the shared wire types
// so they stay in step with `@wombat/shared/api`. A "body" is an entry without its seq, agent and time; `entries()`
// numbers a list of bodies from seq 1 for one agent.
import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/items";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type Body = DistributiveOmit<LogEntry, "seq" | "agentId" | "at">;
type SessionUpdateEntry = Extract<LogEntry, { type: "session_update" }>;
type Update = SessionUpdateEntry["update"];
type ToolCall = Extract<Update, { sessionUpdate: "tool_call" }>;
type ToolCallUpdate = Extract<Update, { sessionUpdate: "tool_call_update" }>;
type PermissionRequested = Extract<LogEntry, { type: "permission_requested" }>;
type PermissionKind = Extract<LogEntry, { type: "permission_answered" }>["kind"];

export const AGENT = "agent-bakery-1";

/** A time for `seq`: one second apart from the start of 2026. */
export const atFor = (seq: number): string => new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + seq * 1000).toISOString();

/** Numbers `bodies` from `firstSeq` (default 1) for `agentId`. */
export const entries = (bodies: Body[], { agentId = AGENT, firstSeq = 1 } = {}): LogEntry[] =>
  bodies.map((body, index) => ({ ...body, seq: firstSeq + index, agentId, at: atFor(firstSeq + index) }));

const update = (value: Update): Body => ({ type: "session_update", update: value });

export const user = (text: string): Body => ({ type: "user_message", text });

const chunkOf =
  (sessionUpdate: "agent_message_chunk" | "agent_thought_chunk") =>
  (text: string, messageId?: string | null): Body =>
    update({ sessionUpdate, content: { type: "text", text }, ...(messageId === undefined ? {} : { messageId }) });

export const chunk = chunkOf("agent_message_chunk");
export const thought = chunkOf("agent_thought_chunk");

export const toolCall = (toolCallId: string, title: string, fields: Partial<Omit<ToolCall, "sessionUpdate" | "toolCallId" | "title">> = {}): Body =>
  update({ sessionUpdate: "tool_call", toolCallId, title, ...fields });

export const toolUpdate = (toolCallId: string, fields: Partial<Omit<ToolCallUpdate, "sessionUpdate" | "toolCallId">> = {}): Body =>
  update({ sessionUpdate: "tool_call_update", toolCallId, ...fields });

export const textContent = (text: string) => ({ type: "content" as const, content: { type: "text" as const, text } });
export const diffContent = (path: string, oldText: string | null, newText: string) => ({ type: "diff" as const, path, oldText, newText });

export const OPTIONS: PermissionRequested["options"] = [
  { kind: "allow_once", name: "Allow" },
  { kind: "reject_once", name: "Reject" },
];

export const permissionRequested = (requestId: string, toolCall: PermissionRequested["toolCall"]): Body => ({
  type: "permission_requested",
  requestId,
  toolCall,
  options: OPTIONS,
});

export const permissionAnswered = (requestId: string, kind: PermissionKind): Body => ({ type: "permission_answered", requestId, kind });

export const plan = (...contents: string[]): Body =>
  update({ sessionUpdate: "plan", entries: contents.map((content) => ({ content, priority: "medium", status: "pending" })) });

export const turnEnded = (stopReason = "end_turn"): Body => ({ type: "turn_ended", stopReason });

/**
 * Entries the chat doesn't show: session updates it has no item for, and an entry type from a newer service (which
 * the client's parse drops, but the chat model must ignore too).
 */
export const UNSHOWN: Body[] = [
  update({ sessionUpdate: "usage_update", used: 1200, size: 200_000 }),
  update({ sessionUpdate: "session_info_update", title: "Opening hours" }),
  update({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "Compact the chat" }] }),
  { type: "future_entry", note: "from a newer service" } as unknown as Body,
];

/** An agent summary as GET /agents lists it. */
export const summary = (id: string, fields: Partial<AgentSummary> = {}): AgentSummary => ({
  id,
  harness: "fake-reply",
  repo: "bakery-site",
  state: "done",
  sessionId: `session-${id}`,
  capabilities: { loadSession: false },
  startedAt: atFor(0),
  lastActivityAt: atFor(1),
  pendingPermissions: [],
  ...fields,
});

/** The body as it came from an ACP session: session updates and permission entries carry their sessionId. */
export const inSession = (body: Body, sessionId: string): Body => ({ ...body, sessionId }) as Body;

/** A known entry type that fails its schema (a user message whose text isn't a string), as a buggy service might store it. */
export const MALFORMED: Body = { type: "user_message", text: { not: "a string" } } as unknown as Body;

/** A pending proposal as GET /proposals lists it (an invented edit to an opening-hours page). */
export const proposal = (id: string, agentId = AGENT): Proposal => ({
  id,
  structure: "pages",
  kind: "update",
  handle: "PAGE-3",
  fields: { title: "Opening hours" },
  file: null,
  reason: "Saturday hours changed",
  baseVersion: "v1",
  status: "pending",
  agentId,
  at: atFor(2),
});
