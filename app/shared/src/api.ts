// The agent service's wire contract. Request bodies are strict (the service rejects
// unknown fields); responses and events are lenient (the app ignores unknown fields),
// so additive changes within one API_VERSION never break an older app.
import { z } from "zod";

const Seq = z.int().nonnegative();
const Timestamp = z.iso.datetime({ offset: true });

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
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const AnswerPermissionRequest = z.strictObject({ kind: PermissionKind });
export type AnswerPermissionRequest = z.infer<typeof AnswerPermissionRequest>;

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
  state: z.enum(["working", "waiting", "done", "error"]),
  sessionId: z.string(),
  title: z.string().exactOptional(),
  capabilities: z.object({ loadSession: z.boolean() }),
  startedAt: Timestamp,
  lastActivityAt: Timestamp,
  error: ErrorDetail.exactOptional(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const ListAgentsResponse = z.object({ seq: Seq, agents: z.array(AgentSummary) });
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

// Events (lenient), sent over `GET /events` with `seq` as the SSE id.

export const ServiceEvent = z.discriminatedUnion("type", [
  z.object({ seq: Seq, type: z.literal("snapshot"), agents: z.array(AgentSummary) }),
  z.object({ seq: Seq, type: z.literal("agent_added"), agent: AgentSummary }),
  z.object({ seq: Seq, type: z.literal("agent_changed"), agent: AgentSummary }),
  z.object({ seq: Seq, type: z.literal("agent_removed"), agentId: z.string() }),
  z.object({ seq: Seq, type: z.literal("session_update"), agentId: z.string(), update: SessionUpdate }),
  z.object({
    seq: Seq,
    type: z.literal("permission_requested"),
    agentId: z.string(),
    requestId: z.string(),
    toolCall: ToolCallUpdateFields,
    options: knownItems(z.object({ kind: PermissionKind, name: z.string() })),
  }),
  z.object({
    seq: Seq,
    type: z.literal("permission_answered"),
    agentId: z.string(),
    requestId: z.string(),
    kind: PermissionKind,
  }),
  z.object({ seq: Seq, type: z.literal("turn_ended"), agentId: z.string(), stopReason: z.string().min(1) }),
]);
export type ServiceEvent = z.infer<typeof ServiceEvent>;

const eventTypes = new Set<unknown>(ServiceEvent.options.map((option) => option.shape.type.value));
const updateKinds: Record<SessionUpdate["sessionUpdate"], true> = {
  agent_message_chunk: true,
  tool_call: true,
  tool_call_update: true,
  session_info_update: true,
  usage_update: true,
  available_commands_update: true,
};

/**
 * Parses one event from the service. Returns undefined for event types and session
 * update kinds this app doesn't know (newer service); throws on a malformed known event.
 */
export const parseServiceEvent = (data: unknown): ServiceEvent | undefined => {
  if (typeof data === "object" && data !== null) {
    const { type, update } = data as { type?: unknown; update?: unknown };
    if (typeof type === "string" && !eventTypes.has(type)) return undefined;
    if (type === "session_update" && typeof update === "object" && update !== null) {
      const kind = (update as { sessionUpdate?: unknown }).sessionUpdate;
      if (typeof kind === "string" && !Object.hasOwn(updateKinds, kind)) return undefined;
    }
  }
  return ServiceEvent.parse(data);
};
