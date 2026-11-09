// The agent service's wire contract. Request bodies are strict (the service rejects
// unknown fields); responses, items and alerts are lenient (the app ignores unknown fields),
// so additive changes within one API_VERSION never break an older app.
//
// Content is stored by the service and read through the API as items. The stream
// (`GET /events`) sends alerts only, each after its change is committed: an alert says that
// something changed, never what. A heartbeat comment line (`: ping`) every ~15 s keeps the
// stream open and isn't an alert.
import { z } from "zod";

const Seq = z.int().nonnegative();
const Timestamp = z.iso.datetime({ offset: true });
const DbId = z.string().min(1);

/** Keeps the items that match `item` and drops the rest (newer kinds we don't know). */
const knownItems = <T extends z.ZodType>(item: T) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((value) => {
      const result = item.safeParse(value);
      return result.success ? [result.data] : [];
    }),
  );

/** `"."` (the workspace root) or relative segments: no absolute, `..`, `.`, empty segments, backslashes or control characters. */
const isRepoPath = (path: string) =>
  [...path].every((char) => char >= " ") &&
  (path === "." ||
    path
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\")));

const PermissionKind = z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]);

// Requests (strict)

export const StartAgentRequest = z.strictObject({
  harness: z.string().min(1),
  repo: z.string().refine(isRepoPath, {
    message: 'repo must be a path relative to the workspace root, like "site-web" or "." for the root itself',
  }),
});
export type StartAgentRequest = z.infer<typeof StartAgentRequest>;

export const SendMessageRequest = z.strictObject({
  text: z.string().regex(/\S/, { message: "text is empty; send the prompt text" }),
  /** Set by the app so a retry after a lost response isn't sent twice. */
  commandId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, { message: "commandId must be 1-64 letters, digits, - or _" })
    .exactOptional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const AnswerPermissionRequest = z.strictObject({ kind: PermissionKind });
export type AnswerPermissionRequest = z.infer<typeof AnswerPermissionRequest>;

/** A whole number from `min` to `max`, from a query-string value (digits only) or a number; `""`, `" "` and repeated keys fail with `message`. */
const queryInt = (message: string, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)], { error: message })
    .pipe(z.int({ error: message }).min(min, { error: message }).max(max, { error: message }));

/** `GET /agents/:id/items?after=&limit=`: items with `seq` above `after`, at most `limit` of them. */
export const ListItemsQuery = z.strictObject(
  {
    after: queryInt("after must be a whole number of 0 or more (an item seq)", 0).default(0),
    limit: queryInt("limit must be a whole number from 1 to 1000", 1, 1000).optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "unknown query parameter; send only after and limit" : undefined,
  },
);
export type ListItemsQuery = z.infer<typeof ListItemsQuery>;

// Responses (lenient)

const ErrorDetail = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().exactOptional(),
});

export const ErrorBody = z.object({ error: ErrorDetail });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const VersionResponse = z.object({ apiVersion: z.int() });
export type VersionResponse = z.infer<typeof VersionResponse>;

export const ListHarnessesResponse = z.array(z.object({ id: z.string(), name: z.string() }));
export type ListHarnessesResponse = z.infer<typeof ListHarnessesResponse>;

export const AgentSummary = z.object({
  id: z.string(),
  harness: z.string(),
  repo: z.string(),
  state: z.enum(["working", "waiting", "done", "error", "stopped"]),
  sessionId: z.string(),
  title: z.string().exactOptional(),
  capabilities: z.object({ loadSession: z.boolean() }),
  startedAt: Timestamp,
  lastActivityAt: Timestamp,
  error: ErrorDetail.exactOptional(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const ListAgentsResponse = z.object({ dbId: DbId, seq: Seq, agents: z.array(AgentSummary) });
export type ListAgentsResponse = z.infer<typeof ListAgentsResponse>;

// ACP session updates we render: a subset of the fields of ACP v1's `SessionUpdate`.

const TextContent = z.object({ type: z.literal("text"), text: z.string() });
const ImageContent = z.object({
  type: z.literal("image"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z.base64().min(1),
});

/** Text or a supported image; any other block becomes `{ type: "unsupported", original }` (shown as "not shown"). */
const ContentBlock = z.union([
  TextContent,
  ImageContent,
  z
    .object({ type: z.string().refine((type) => type !== "text") })
    .transform(({ type }) => ({
      type: "unsupported" as const,
      original: /^[a-z_]{1,32}$/.test(type) ? type : "unknown",
    })),
]);

// Newer ACP tool kinds read as "other".
const ToolKind = z
  .enum(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"])
  .catch("other");
const ToolCallStatus = z.enum(["pending", "in_progress", "completed", "failed"]);

/** Drops `status` when it isn't one we know (newer ACP), instead of failing the whole tool call. */
const knownStatus =
  <S extends z.ZodType>(status: S) =>
  <T extends { status?: unknown }>({ status: value, ...rest }: T): Omit<T, "status"> & { status?: z.output<S> } => {
    const result = status.safeParse(value);
    return result.success ? { ...rest, status: result.data } : rest;
  };

const ToolCallContent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content"), content: ContentBlock }),
  z.object({
    type: z.literal("diff"),
    path: z.string(),
    oldText: z.string().nullable().exactOptional(),
    newText: z.string(),
  }),
]);

const ToolCallLocation = z.object({ path: z.string(), line: z.number().nullable().exactOptional() });

const toolCallUpdateFields = {
  toolCallId: z.string(),
  title: z.string().nullable().exactOptional(),
  kind: ToolKind.nullable().exactOptional(),
  status: z.unknown().exactOptional(),
  content: knownItems(ToolCallContent).nullable().exactOptional(),
  locations: knownItems(ToolCallLocation).nullable().exactOptional(),
  rawInput: z.unknown().exactOptional(),
  rawOutput: z.unknown().exactOptional(),
};
const ToolCallUpdateFields = z.object(toolCallUpdateFields).transform(knownStatus(ToolCallStatus.nullable()));

export const SessionUpdate = z.discriminatedUnion("sessionUpdate", [
  z.object({
    sessionUpdate: z.literal("agent_message_chunk"),
    messageId: z.string().nullable().exactOptional(),
    content: ContentBlock,
  }),
  z
    .object({
      sessionUpdate: z.literal("tool_call"),
      toolCallId: z.string(),
      title: z.string(),
      kind: ToolKind.exactOptional(),
      status: z.unknown().exactOptional(),
      content: knownItems(ToolCallContent).exactOptional(),
      locations: knownItems(ToolCallLocation).exactOptional(),
      rawInput: z.unknown().exactOptional(),
      rawOutput: z.unknown().exactOptional(),
    })
    .transform(knownStatus(ToolCallStatus)),
  z
    .object({ sessionUpdate: z.literal("tool_call_update"), ...toolCallUpdateFields })
    .transform(knownStatus(ToolCallStatus.nullable())),
  z.object({
    sessionUpdate: z.literal("session_info_update"),
    title: z.string().nullable().exactOptional(),
    updatedAt: z.string().nullable().exactOptional(),
  }),
  z.object({
    sessionUpdate: z.literal("usage_update"),
    used: z.number(),
    size: z.number(),
    cost: z.object({ amount: z.number(), currency: z.string() }).nullable().exactOptional(),
  }),
  z.object({
    sessionUpdate: z.literal("available_commands_update"),
    availableCommands: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        // An input shape newer than ACP v1's reads as null; the command is kept.
        input: z.object({ hint: z.string() }).nullable().catch(null).exactOptional(),
      }),
    ),
  }),
]);
export type SessionUpdate = z.infer<typeof SessionUpdate>;

// Items (lenient): an agent's stored history, read through `GET /agents/:id/items`.

const itemFields = { seq: Seq, agentId: z.string(), at: Timestamp };
/** The ACP session an update or permission request came from; one agent may run more than one (sub-agents). */
const SessionId = z.string().exactOptional();

export const Item = z.discriminatedUnion("type", [
  z.object({
    ...itemFields,
    type: z.literal("user_message"),
    text: z.string(),
    commandId: z.string().exactOptional(),
  }),
  z.object({ ...itemFields, type: z.literal("session_update"), sessionId: SessionId, update: SessionUpdate }),
  z.object({
    ...itemFields,
    type: z.literal("permission_requested"),
    sessionId: SessionId,
    requestId: z.string(),
    toolCall: ToolCallUpdateFields,
    options: knownItems(z.object({ kind: PermissionKind, name: z.string() })),
  }),
  z.object({
    ...itemFields,
    type: z.literal("permission_answered"),
    sessionId: SessionId,
    requestId: z.string(),
    kind: PermissionKind,
  }),
  z.object({ ...itemFields, type: z.literal("turn_ended"), stopReason: z.string().min(1) }),
]);
export type Item = z.infer<typeof Item>;

const itemTypes = new Set<unknown>(Item.options.map((option) => option.shape.type.value));
const updateKinds: Record<SessionUpdate["sessionUpdate"], true> = {
  agent_message_chunk: true,
  tool_call: true,
  tool_call_update: true,
  session_info_update: true,
  usage_update: true,
  available_commands_update: true,
};

/** An item of a type, or carrying a session update kind, that this app doesn't know (newer service). */
const isUnknownItem = (data: unknown) => {
  if (typeof data !== "object" || data === null) return false;
  const { type, update } = data as { type?: unknown; update?: unknown };
  if (typeof type === "string" && !itemTypes.has(type)) return true;
  if (type === "session_update" && typeof update === "object" && update !== null) {
    const updateKind = (update as { sessionUpdate?: unknown }).sessionUpdate;
    return typeof updateKind === "string" && !Object.hasOwn(updateKinds, updateKind);
  }
  return false;
};

/**
 * Parses one item from the service. Returns undefined for item types and session update
 * kinds this app doesn't know (newer service); throws on a malformed known item.
 */
export const parseItem = (data: unknown): Item | undefined => (isUnknownItem(data) ? undefined : Item.parse(data));

export const ListItemsResponse = z.object({
  dbId: DbId,
  seq: Seq,
  // Unknown items are dropped as parseItem would; a malformed known one fails the parse.
  items: z
    .array(z.unknown())
    .transform((items) => items.filter((value) => !isUnknownItem(value)))
    .pipe(z.array(Item)),
  truncated: z.boolean(),
});
export type ListItemsResponse = z.infer<typeof ListItemsResponse>;

// Alerts (lenient), sent over `GET /events` after the change is committed.

/**
 * Says that something changed for an agent, up to `seq`; the app fetches the change.
 * Unknown fields are stripped, so an alert never carries agent content even if one is sent.
 */
export const Alert = z.object({
  seq: Seq,
  dbId: DbId,
  type: z.enum(["agent_added", "agent_changed", "agent_removed", "items"]),
  agentId: z.string(),
});
export type Alert = z.infer<typeof Alert>;

const alertTypes = new Set<unknown>(Alert.shape.type.options);

/** Parses one alert. Returns undefined for alert types this app doesn't know (newer service); throws on a malformed known alert. */
export const parseAlert = (data: unknown): Alert | undefined => {
  if (typeof data === "object" && data !== null) {
    const { type } = data as { type?: unknown };
    if (typeof type === "string" && !alertTypes.has(type)) return undefined;
  }
  return Alert.parse(data);
};
