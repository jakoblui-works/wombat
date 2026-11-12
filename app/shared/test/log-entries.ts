// Invented log entries for the log fold's and the renderer's tests, built through the shared wire types so they stay
// in step with `api.ts`. A "body" is an entry without its seq, agent and time; `entries()` numbers a list of bodies
// from seq 1 for one agent.
import type { LogEntry, SessionUpdate } from "../src/api.ts";
import type { ChatItem } from "../src/log-fold.ts";

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

type ConfigOptionUpdate = Extract<Update, { sessionUpdate: "config_option_update" }>;
type UsageUpdate = Extract<Update, { sessionUpdate: "usage_update" }>;

export const configUpdate = (configOptions: ConfigOptionUpdate["configOptions"]): Body => update({ sessionUpdate: "config_option_update", configOptions });

export const usage = (used: number, size: number, cost?: UsageUpdate["cost"]): Body =>
  update({ sessionUpdate: "usage_update", used, size, ...(cost === undefined ? {} : { cost }) });

/** A select and a boolean, as an agent offers them; `model` and `fast` pick their current values. */
export const sampleConfig = (model: "fast-model" | "deep-model", fast: boolean): ConfigOptionUpdate["configOptions"] => [
  {
    type: "select",
    id: "model",
    name: "Model",
    currentValue: model,
    options: [
      { value: "fast-model", name: "Fast model" },
      { value: "deep-model", name: "Deep model" },
    ],
  },
  { type: "boolean", id: "fast", name: "Fast mode", currentValue: fast },
];

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
 * Per session update kind, an entry of it that the chat doesn't show, or "shown". Keyed by every kind, so a kind added
 * to `api.ts` fails typecheck until it is decided here.
 */
const UNSHOWN_UPDATES: Record<SessionUpdate["sessionUpdate"], Body | "shown"> = {
  agent_message_chunk: "shown",
  agent_thought_chunk: "shown",
  plan: "shown",
  tool_call: "shown",
  tool_call_update: "shown",
  usage_update: update({ sessionUpdate: "usage_update", used: 1200, size: 200_000 }),
  config_option_update: update({ sessionUpdate: "config_option_update", configOptions: sampleConfig("fast-model", false) }),
  session_info_update: update({ sessionUpdate: "session_info_update", title: "Opening hours" }),
  available_commands_update: update({
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "compact", description: "Compact the chat" }],
  }),
};

/**
 * Entries the chat doesn't show: session updates it has no item for, and an entry type from a newer service (which
 * the client's parse drops, but the chat model must ignore too).
 */
export const UNSHOWN: Body[] = [
  ...Object.values(UNSHOWN_UPDATES).filter((body): body is Body => body !== "shown"),
  { type: "future_entry", note: "from a newer service" } as unknown as Body,
];

/** The body as it came from an ACP session: session updates and permission entries carry their sessionId. */
export const inSession = (body: Body, sessionId: string): Body => ({ ...body, sessionId }) as Body;

/** A known entry type that fails its schema (a user message whose text isn't a string), as a buggy service might store it. */
export const MALFORMED: Body = { type: "user_message", text: { not: "a string" } } as unknown as Body;

/** An item as [kind, its text or id], to compare item lists by what they show. */
export const shape = (item: ChatItem): [string, string] => {
  switch (item.kind) {
    case "user":
    case "agent":
    case "reasoning":
      return [item.kind, item.text];
    case "tool":
      return [item.kind, item.toolCallId];
    case "permission":
      return [item.kind, item.requestId];
    case "turn_end":
      return [item.kind, item.stopReason];
    default:
      return [item.kind, ""];
  }
};
