// Turns an agent's log into what the chat shows. Pure, and the same however the log arrived: entries are taken in
// seq order, once each (chat-model.append-order.test.ts).
import type { LogEntry } from "@wombat/shared/api";
import type { AgentLogEntry } from "./query-client.ts";

type Update = Extract<LogEntry, { type: "session_update" }>["update"];
type ToolCall = Extract<Update, { sessionUpdate: "tool_call" }>;
type ToolCallUpdate = Extract<Update, { sessionUpdate: "tool_call_update" }>;
type PermissionKind = Extract<LogEntry, { type: "permission_answered" }>["kind"];

export type PlanEntry = Extract<Update, { sessionUpdate: "plan" }>["entries"][number];
export type ToolKind = NonNullable<ToolCall["kind"]>;
export type ToolCallStatus = NonNullable<ToolCall["status"]>;
export type ToolCallContent = NonNullable<ToolCall["content"]>[number];
export type ToolCallLocation = NonNullable<ToolCall["locations"]>[number];

/** Every item has these; `sessionId` only on items from another ACP session than the main one (a sub-agent's). */
type ItemBase = { key: string; at: string; sessionId?: string };

export type ChatItem = ItemBase &
  (
    | { kind: "user"; text: string }
    | { kind: "agent"; text: string }
    | { kind: "reasoning"; text: string }
    | {
        kind: "tool";
        toolCallId: string;
        title: string;
        toolKind: ToolKind;
        status?: ToolCallStatus;
        input?: unknown;
        output?: unknown;
        content: ToolCallContent[];
        locations: ToolCallLocation[];
      }
    | {
        kind: "permission";
        requestId: string;
        toolCallId: string;
        title: string;
        options: { kind: PermissionKind; name: string }[];
        answer?: PermissionKind | "cancelled";
      }
    | { kind: "turn_end"; stopReason: string }
    /** An entry the app couldn't read; its content isn't shown. */
    | { kind: "unreadable" }
  );

export type ChatModel = { items: ChatItem[]; plan?: PlanEntry[]; turnActive: boolean };

export type ChatModelOptions = {
  /** The agent's own session (`AgentSummary.sessionId`); without it, the session of the first entry that has one. */
  mainSessionId?: string;
};

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type PermissionItem = Extract<ChatItem, { kind: "permission" }>;
type TextItem = Extract<ChatItem, { kind: "agent" | "reasoning" }>;

/** Entries that come from an ACP session and may say which (entries from before sessionId was stored don't). */
const fromSession = (entry: AgentLogEntry): entry is Extract<LogEntry, { sessionId?: string }> =>
  entry.type === "session_update" || entry.type === "permission_requested" || entry.type === "permission_answered";

/** Applies the fields a tool call or its update carries: a present field replaces, a null one clears. */
const applyToolFields = (item: ToolItem, fields: Omit<ToolCallUpdate, "sessionUpdate">): void => {
  if (fields.title !== undefined) item.title = fields.title ?? "";
  if (fields.kind !== undefined) item.toolKind = fields.kind ?? "other";
  if (fields.status !== undefined) {
    if (fields.status === null) delete item.status;
    else item.status = fields.status;
  }
  if (fields.rawInput !== undefined) {
    if (fields.rawInput === null) delete item.input;
    else item.input = fields.rawInput;
  }
  if (fields.rawOutput !== undefined) {
    if (fields.rawOutput === null) delete item.output;
    else item.output = fields.rawOutput;
  }
  if (fields.content !== undefined) item.content = fields.content ?? [];
  if (fields.locations !== undefined) item.locations = fields.locations ?? [];
};

/** In seq order, each seq once. */
const ordered = (entries: readonly AgentLogEntry[]): AgentLogEntry[] => {
  const bySeq = new Map<number, AgentLogEntry>();
  for (const entry of entries) if (!bySeq.has(entry.seq)) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

export const chatModel = (entries: readonly AgentLogEntry[], { mainSessionId }: ChatModelOptions = {}): ChatModel => {
  const log = ordered(entries);
  const main = mainSessionId ?? log.find(fromSession)?.sessionId;
  /** The entry's session when it isn't the main one; an entry without a sessionId belongs to the main one. */
  const sessionOf = (entry: AgentLogEntry): string | undefined =>
    fromSession(entry) && entry.sessionId !== undefined && entry.sessionId !== main ? entry.sessionId : undefined;
  const withSession = <T extends ChatItem>(item: T, session: string | undefined): T => (session === undefined ? item : { ...item, sessionId: session });

  const items: ChatItem[] = [];
  const tools = new Map<string, ToolItem>();
  const permissions = new Map<string, { item: PermissionItem; ownTitle: string | undefined; cancelled: boolean }>();
  const answers = new Map<string, PermissionKind>();
  // The message or reasoning that chunks extend. Only placing a new item ends it: entries that update or answer
  // something earlier (an answer, a plan, an update to an earlier tool) and entries the chat doesn't show don't.
  let run: { item: TextItem; messageId: string | undefined; session: string | undefined } | undefined;
  let plan: PlanEntry[] | undefined;
  let turnActive = false;

  const place = <T extends ChatItem>(item: T): T => {
    items.push(item);
    run = undefined;
    return item;
  };

  for (const entry of log) {
    const session = sessionOf(entry);
    switch (entry.type) {
      case "user_message":
        place({ kind: "user", key: `user:${String(entry.seq)}`, text: entry.text, at: entry.at });
        turnActive = true;
        break;
      case "turn_ended":
        place({ kind: "turn_end", key: `turn_end:${String(entry.seq)}`, stopReason: entry.stopReason, at: entry.at });
        turnActive = false;
        for (const permission of permissions.values()) permission.cancelled = true;
        break;
      case "unreadable":
        place({ kind: "unreadable", key: `unreadable:${String(entry.seq)}`, at: entry.at });
        break;
      case "permission_requested": {
        if (permissions.has(entry.requestId)) break;
        const { toolCallId, title } = entry.toolCall;
        const item = place(
          withSession<PermissionItem>(
            {
              kind: "permission",
              key: `permission:${entry.requestId}`,
              requestId: entry.requestId,
              toolCallId,
              title: "",
              options: entry.options.map(({ kind, name }) => ({ kind, name })),
              at: entry.at,
            },
            session,
          ),
        );
        // An empty title counts as none, so the tool's title shows instead.
        permissions.set(entry.requestId, { item, ownTitle: title || undefined, cancelled: false });
        break;
      }
      case "permission_answered":
        answers.set(entry.requestId, entry.kind);
        break;
      case "session_update": {
        const update = entry.update;
        switch (update.sessionUpdate) {
          case "agent_message_chunk":
          case "agent_thought_chunk": {
            const kind = update.sessionUpdate === "agent_message_chunk" ? "agent" : "reasoning";
            const text = update.content.type === "text" ? update.content.text : "";
            const messageId = update.messageId ?? undefined;
            // An absent messageId continues the run; a different one starts a new item.
            if (
              run?.item.kind === kind &&
              run.session === session &&
              (messageId === undefined || run.messageId === undefined || messageId === run.messageId)
            ) {
              run.item.text += text;
              run.messageId ??= messageId;
            } else {
              const item = place(withSession<TextItem>({ kind, key: `${kind}:${String(entry.seq)}`, text, at: entry.at }, session));
              run = { item, messageId, session };
            }
            break;
          }
          case "tool_call":
          case "tool_call_update": {
            let item = tools.get(update.toolCallId);
            if (item === undefined) {
              item = place(
                withSession<ToolItem>(
                  {
                    kind: "tool",
                    key: `tool:${update.toolCallId}`,
                    toolCallId: update.toolCallId,
                    title: "",
                    toolKind: "other",
                    content: [],
                    locations: [],
                    at: entry.at,
                  },
                  session,
                ),
              );
              tools.set(update.toolCallId, item);
            }
            applyToolFields(item, update);
            break;
          }
          case "plan":
            plan = update.entries;
            break;
          // Session updates the chat has no item for.
          default:
            break;
        }
        break;
      }
      // Entry types from a newer service.
      default:
        break;
    }
  }

  for (const { item, ownTitle, cancelled } of permissions.values()) {
    item.title = ownTitle ?? tools.get(item.toolCallId)?.title ?? "";
    const answer = answers.get(item.requestId) ?? (cancelled ? "cancelled" : undefined);
    if (answer !== undefined) item.answer = answer;
  }

  return { items, ...(plan === undefined ? {} : { plan }), turnActive };
};
