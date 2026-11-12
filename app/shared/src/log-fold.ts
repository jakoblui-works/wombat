// An agent's log folded into items: the one reading of the log that the chat and the agent list share, so a row's
// message and request titles can't differ from what the chat shows.
import { permissionTitle, type Activity, type ConfigOption, type LogEntry, type SessionUpdate } from "./api.ts";

type ToolCall = Extract<SessionUpdate, { sessionUpdate: "tool_call" }>;
type ToolCallUpdate = Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>;
type PermissionRequest = Extract<LogEntry, { type: "permission_requested" }>;
type PermissionKind = Extract<LogEntry, { type: "permission_answered" }>["kind"];

export type PlanEntry = Extract<SessionUpdate, { sessionUpdate: "plan" }>["entries"][number];
export type ToolKind = NonNullable<ToolCall["kind"]>;
export type ToolCallStatus = NonNullable<ToolCall["status"]>;
export type ToolCallContent = NonNullable<ToolCall["content"]>[number];
export type ToolCallLocation = NonNullable<ToolCall["locations"]>[number];
/** The agent's context use: a `usage_update`'s fields. */
export type Usage = Omit<Extract<SessionUpdate, { sessionUpdate: "usage_update" }>, "sessionUpdate">;

/** A stored entry of a known type that fails its schema: kept in its place, as an item without its content. */
export type UnreadableEntry = { type: "unreadable"; seq: number; at: string };

/** What `foldEntry` takes: a stored entry, or one the reader couldn't parse. */
export type FoldEntry = LogEntry | UnreadableEntry;

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
        /** Left unset by the fold; a reader sets it from `answers` and `cancelled`. */
        answer?: PermissionKind | "cancelled";
      }
    | { kind: "turn_end"; stopReason: string }
    /** An entry the app couldn't read; its content isn't shown. */
    | { kind: "unreadable" }
  );

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type PermissionItem = Extract<ChatItem, { kind: "permission" }>;
type TextItem = Extract<ChatItem, { kind: "agent" | "reasoning" }>;

/** A permission request as asked: its item, its own tool call's title and kind, and whether a turn ended after it. */
type FoldPermission = {
  item: PermissionItem;
  ownTitle: string | null | undefined;
  ownKind: ToolKind | null | undefined;
  cancelled: boolean;
};

/**
 * Fields callers may read; only `foldEntry` writes them, except that a reader may set a permission item's `title` and
 * `answer` (the fold leaves them for it; see `permissionOf`, `answers` and `cancelled`).
 */
export type FoldState = {
  /** In placing order. */
  items: ChatItem[];
  /** The latest plan update's entries. */
  plan?: PlanEntry[];
  /** The latest main-session `config_option_update`'s options. */
  config?: ConfigOption[];
  /** The latest main-session `usage_update`, without its kind. */
  usage?: Usage;
  /** The main session's latest chunk or tool call since the last user message; what `activityOf` reads. */
  latest?: { kind: "thinking" | "writing" } | { kind: "tool"; toolCallId: string };
  /** From a user message until the next turn end. */
  turnActive: boolean;
  /**
   * The given main session, else the sessionId of the first entry of a type that can carry one, even when that entry
   * has none (an old log: the main session is then the entries without one). Fixed once `mainSessionDecided`.
   */
  mainSessionId: string | undefined;
  mainSessionDecided: boolean;
  tools: Map<string, ToolItem>;
  permissions: Map<string, FoldPermission>;
  answers: Map<string, PermissionKind>;
  /** The open message run: the text item that the next matching chunk extends. */
  run: { item: TextItem; messageId: string | undefined; session: string | undefined } | undefined;
};

export type FoldOptions = {
  /** What is kept of a text item's text after `chunk` arrives; may only drop text, never reorder it. */
  keepText: (kept: string, chunk: string) => string;
};

export const emptyFold = (mainSessionId?: string): FoldState => ({
  items: [],
  turnActive: false,
  mainSessionId,
  mainSessionDecided: mainSessionId !== undefined,
  tools: new Map(),
  permissions: new Map(),
  answers: new Map(),
  run: undefined,
});

/** A tool call's fields besides its id, as the update type carries them (any may be null). */
type ToolFields = Omit<ToolCallUpdate, "sessionUpdate" | "toolCallId">;

/**
 * How each field applies: a present value replaces, null clears. Typed against every field of the update type, so a
 * field added to the schema and not handled here fails typecheck.
 */
const toolFieldAppliers: { [K in keyof ToolFields]-?: (item: ToolItem, value: Exclude<ToolFields[K], undefined>) => void } = {
  title: (item, value) => {
    item.title = value ?? "";
  },
  kind: (item, value) => {
    item.toolKind = value ?? "other";
  },
  status: (item, value) => {
    if (value === null) delete item.status;
    else item.status = value;
  },
  rawInput: (item, value) => {
    if (value === null) delete item.input;
    else item.input = value;
  },
  rawOutput: (item, value) => {
    if (value === null) delete item.output;
    else item.output = value;
  },
  content: (item, value) => {
    item.content = value ?? [];
  },
  locations: (item, value) => {
    item.locations = value ?? [];
  },
};

/** Applies the fields a tool call or its update carries: a present field replaces, a null one clears, an absent one stays. */
const applyToolFields = (item: ToolItem, fields: ToolFields): void => {
  for (const key of Object.keys(toolFieldAppliers) as (keyof ToolFields)[]) {
    const value = fields[key];
    if (value !== undefined) (toolFieldAppliers[key] as (item: ToolItem, value: unknown) => void)(item, value);
  }
};

/** Entries that come from an ACP session and may say which (entries from before sessionId was stored don't). */
const fromSession = (entry: FoldEntry): entry is Extract<LogEntry, { sessionId?: string }> =>
  entry.type === "session_update" || entry.type === "permission_requested" || entry.type === "permission_answered";

const place = <T extends ChatItem>(state: FoldState, item: T, session: string | undefined): T => {
  const placed = session === undefined ? item : { ...item, sessionId: session };
  state.items.push(placed);
  state.run = undefined;
  return placed;
};

const placePermission = (state: FoldState, entry: PermissionRequest, session: string | undefined): void => {
  if (state.permissions.has(entry.requestId)) return;
  const { toolCallId, title, kind } = entry.toolCall;
  const item = place<PermissionItem>(
    state,
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
  );
  state.permissions.set(entry.requestId, { item, ownTitle: title, ownKind: kind, cancelled: false });
};

const foldUpdate = (state: FoldState, entry: Extract<LogEntry, { type: "session_update" }>, session: string | undefined, { keepText }: FoldOptions): void => {
  const update = entry.update;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const kind = update.sessionUpdate === "agent_message_chunk" ? "agent" : "reasoning";
      if (session === undefined) state.latest = { kind: kind === "agent" ? "writing" : "thinking" };
      const text = update.content.type === "text" ? update.content.text : "";
      const messageId = update.messageId ?? undefined;
      const run = state.run;
      if (
        run?.item.kind === kind &&
        run.session === session &&
        (messageId === undefined || run.messageId === undefined || messageId === run.messageId)
      ) {
        run.item.text = keepText(run.item.text, text);
        run.messageId ??= messageId;
      } else {
        const item = place<TextItem>(state, { kind, key: `${kind}:${String(entry.seq)}`, text: keepText("", text), at: entry.at }, session);
        state.run = { item, messageId, session };
      }
      return;
    }
    case "tool_call":
    case "tool_call_update": {
      let item = state.tools.get(update.toolCallId);
      if (item === undefined) {
        item = place<ToolItem>(
          state,
          { kind: "tool", key: `tool:${update.toolCallId}`, toolCallId: update.toolCallId, title: "", toolKind: "other", content: [], locations: [], at: entry.at },
          session,
        );
        state.tools.set(update.toolCallId, item);
      }
      applyToolFields(item, update);
      if (session === undefined) state.latest = { kind: "tool", toolCallId: update.toolCallId };
      return;
    }
    case "plan":
      state.plan = update.entries;
      return;
    case "config_option_update":
      if (session === undefined) state.config = update.configOptions;
      return;
    case "usage_update":
      if (session === undefined) state.usage = { used: update.used, size: update.size, ...(update.cost === undefined ? {} : { cost: update.cost }) };
      return;
    // Session updates without an item.
    default:
      return;
  }
};

/**
 * Folds one entry into `state`, which it updates and returns (the caller owns the state; a long log folds in linear
 * time). Deterministic, no I/O. Entries are taken in the order given: sorting and dropping repeats is the caller's.
 *
 * The rules:
 * 1. Only placing a new item ends a message run (a user message, an agent or reasoning chunk with another messageId or
 *    kind or session, a tool, a permission request, a turn end, an unreadable entry). Entries that update or answer
 *    something earlier (a tool update, an answer, a plan), and session updates without an item, don't.
 * 2. An absent or null `messageId` continues the run; two different non-null ones split it.
 * 3. An item from a session other than the main one carries `sessionId`; a run never spans two sessions. An entry
 *    without a sessionId belongs to the main session.
 * 4. A tool call or update: a present field replaces, a null one clears (title to `""`, kind to `"other"`, the others
 *    removed or emptied). An update for an unknown call places the tool item where it stands.
 * 5. Only main-session updates set `config`, `usage` and `latest`; a user message clears `latest` (a new turn starts
 *    from scratch) but keeps `config` and `usage`.
 *
 * `keepText(kept, chunk)` decides what a text item keeps, from its first chunk on (a new item holds
 * `keepText("", chunk)`); it may only drop text, never reorder it. A chunk that starts an item places it even when its
 * text is empty. Entry types from a newer service are ignored.
 */
export const foldEntry = (state: FoldState, entry: FoldEntry, options: FoldOptions): FoldState => {
  if (!state.mainSessionDecided && fromSession(entry)) {
    state.mainSessionId = entry.sessionId;
    state.mainSessionDecided = true;
  }
  const session = fromSession(entry) && entry.sessionId !== undefined && entry.sessionId !== state.mainSessionId ? entry.sessionId : undefined;
  switch (entry.type) {
    case "user_message":
      place(state, { kind: "user", key: `user:${String(entry.seq)}`, text: entry.text, at: entry.at }, undefined);
      state.turnActive = true;
      delete state.latest;
      break;
    case "turn_ended":
      place(state, { kind: "turn_end", key: `turn_end:${String(entry.seq)}`, stopReason: entry.stopReason, at: entry.at }, undefined);
      state.turnActive = false;
      for (const permission of state.permissions.values()) permission.cancelled = true;
      break;
    case "unreadable":
      place(state, { kind: "unreadable", key: `unreadable:${String(entry.seq)}`, at: entry.at }, undefined);
      break;
    case "permission_requested":
      placePermission(state, entry, session);
      break;
    case "permission_answered":
      state.answers.set(entry.requestId, entry.kind);
      break;
    case "session_update":
      foldUpdate(state, entry, session, options);
      break;
    // Entry types from a newer service.
    default:
      break;
  }
  return state;
};

/** A permission's title and kind when nothing names them: neither its request nor a tool item with its id. */
export const UNKNOWN_PERMISSION: Readonly<{ title: string; kind: ToolKind }> = { title: "", kind: "other" };

/**
 * A permission request's title and kind: the title by `permissionTitle` (its own, else its tool item's); the kind its
 * own, else its tool item's, else `UNKNOWN_PERMISSION`'s. Undefined for a request the fold hasn't seen.
 */
export const permissionOf = (state: FoldState, requestId: string): { title: string; kind: ToolKind } | undefined => {
  const permission = state.permissions.get(requestId);
  if (permission === undefined) return undefined;
  const tool = state.tools.get(permission.item.toolCallId);
  return {
    title: permissionTitle(permission.ownTitle, tool?.title ?? UNKNOWN_PERMISSION.title),
    kind: permission.ownKind ?? tool?.toolKind ?? UNKNOWN_PERMISSION.kind,
  };
};

/** Keeps every chunk's text: how the chat reads a log. */
export const keepAll = (kept: string, chunk: string): string => kept + chunk;

/**
 * The chat's reading of a log: the entries folded in the order given, keeping all text, for `mainSessionId` (else the
 * one the log names). Ordering the entries is the caller's.
 */
export const foldLog = (entries: Iterable<FoldEntry>, mainSessionId?: string): FoldState => {
  const state = emptyFold(mainSessionId);
  for (const entry of entries) foldEntry(state, entry, { keepText: keepAll });
  return state;
};

/** The text of the last agent item from the main session: the agent list's row message. Undefined when there is none. */
export const lastMainMessage = (state: FoldState): string | undefined =>
  state.items.findLast((item): item is Extract<ChatItem, { kind: "agent" }> => item.kind === "agent" && item.sessionId === undefined)?.text;

/**
 * What the agent is doing, by its main session's latest update this turn: the one rule the agent list's row and the
 * chat's working line share. Null unless a turn is active. A thought chunk gives `thinking`, a message chunk
 * `writing`, a tool call or its update `tool` with the tool item's title (left out when empty), unless that tool has
 * completed or failed: then `thinking`, as the agent decides its next step. Nothing yet this turn gives `thinking`.
 */
export const activityOf = (state: FoldState): Activity | null => {
  if (!state.turnActive) return null;
  const latest = state.latest;
  if (latest?.kind !== "tool") return { kind: latest?.kind ?? "thinking" };
  const tool = state.tools.get(latest.toolCallId);
  if (tool?.status === "completed" || tool?.status === "failed") return { kind: "thinking" };
  return tool === undefined || tool.title === "" ? { kind: "tool" } : { kind: "tool", title: tool.title };
};

/** Whether two activities read the same (kind and title): the manager writes the summary only when they don't. */
export const sameActivity = (a: Activity | null, b: Activity | null): boolean =>
  a === null || b === null ? a === b : a.kind === b.kind && a.title === b.title;

/**
 * The agent's settings now: the latest main-session `config_option_update`'s options, kept across turns (a user
 * message doesn't clear them). A sub-agent's never replace them. Undefined before the first.
 */
export const configOf = (state: FoldState): ConfigOption[] | undefined => state.config;

/** The agent's context use now: the latest main-session `usage_update`, kept across turns. Undefined before the first. */
export const usageOf = (state: FoldState): Usage | undefined => state.usage;
