// The agent service's wire contract. Request bodies are strict (the service rejects
// unknown fields); responses, entries and alerts are lenient (the app ignores unknown fields),
// so additive changes within one API_VERSION never break an older app.
//
// Content is stored by the service and read through the API as entries. The stream
// (`GET /events`) sends alerts only, each after its change is committed: an alert says that
// something changed, never what. A heartbeat comment line (`: ping`) every HEARTBEAT_MS keeps
// the stream open and isn't an alert.
import { z } from "zod";

import { Item, ItemSummary, knownItems, Proposal, ProposalStatus, StructureSummary } from "./items.ts";
import { MAX_BODY_BYTES } from "./routes.ts";

const Seq = z.int().nonnegative();
const Timestamp = z.iso.datetime({ offset: true });
const DbId = z.string().min(1);

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

/** `POST /agents/:id/config`: a select's value id, or a boolean's value. Idempotent, so it carries no commandId. */
export const SetConfigRequest = z.strictObject({ configId: z.string().min(1), value: z.union([z.string(), z.boolean()]) });
export type SetConfigRequest = z.infer<typeof SetConfigRequest>;

/** A whole number from `min` to `max`, from a query-string value (digits only) or a number; `""`, `" "` and repeated keys fail with `message`. */
const queryInt = (message: string, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)], { error: message })
    .pipe(z.int({ error: message }).min(min, { error: message }).max(max, { error: message }));

/** `GET /agents/:id/log?after=&limit=`: entries with `seq` above `after`, at most `limit` of them. */
export const ListLogQuery = z.strictObject(
  {
    after: queryInt("after must be a whole number of 0 or more (an entry seq)", 0).default(0),
    limit: queryInt("limit must be a whole number from 1 to 1000", 1, 1000).optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "unknown query parameter; send only after and limit" : undefined,
  },
);
export type ListLogQuery = z.infer<typeof ListLogQuery>;

/** `GET /proposals?status=`: every proposal, or those with one status. */
export const ListProposalsQuery = z.strictObject(
  {
    status: z
      .enum(ProposalStatus.options, { error: "status must be one of pending, approved, rejected or conflict" })
      .exactOptional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "unknown query parameter; send only status" : undefined,
  },
);
export type ListProposalsQuery = z.infer<typeof ListProposalsQuery>;

// Responses (lenient)

const ErrorDetail = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().exactOptional(),
});

export const ErrorBody = z.object({ error: ErrorDetail });
export type ErrorBody = z.infer<typeof ErrorBody>;

// Error codes: `ErrorBody.code` stays a plain string on read (a newer service may add codes), but every code the
// service sends is one of these, so the app can switch on them by name.

/**
 * Any route, before it runs: `unauthorized` without the discovery file's token, or on /mcp without a live agent
 * token; `forbidden_origin` for an Origin other than the app's; `forbidden_host` for a Host other than the bound
 * loopback address. The app re-reads the discovery file and reconnects; it never retries with the same token.
 * Then, per request: `payload_too_large` for a body over 1 MiB, `invalid_request` for a body or query off the
 * contract (a bug in the app: show the message), `not_found` for an unknown route, `method_not_allowed` for
 * /events or /mcp with the wrong method, `internal_error` when the service failed (show the message; the request
 * may be retried).
 */
export const ServerErrorCode = z.enum([
  "unauthorized",
  "forbidden_origin",
  "forbidden_host",
  "payload_too_large",
  "invalid_request",
  "not_found",
  "method_not_allowed",
  "internal_error",
]);
export type ServerErrorCode = z.infer<typeof ServerErrorCode>;

/** The message for a body over MAX_BODY_BYTES: the service's `payload_too_large`, and the app's refusal before sending. */
export const BODY_OVER_CAP_MESSAGE = `The request body is over ${String(MAX_BODY_BYTES / 1024 / 1024)} MiB, more than the service takes. Send a shorter one.`;

/**
 * `POST /agents` when the repo path doesn't name a folder in the workspace (`repo_not_found`) or leads out of it
 * through a symlink (`repo_outside_workspace`). The app shows the message and lets the user pick another repo.
 */
export const RepoErrorCode = z.enum(["repo_not_found", "repo_outside_workspace"]);
export type RepoErrorCode = z.infer<typeof RepoErrorCode>;

/**
 * The agent routes' error codes, and an agent summary's `error.code`:
 * - `not_found`: no agent with that id (any `/agents/:id` route), or no open permission request with that id
 *   (`POST /agents/:id/permissions/:requestId`). The app refetches the agents or the log.
 * - `busy`: `POST /agents/:id/messages` while a turn runs. The app waits for the turn to end, or cancels it.
 * - `not_running`: a command to a stopped or exited agent, or to a service shutting down. The app offers a new
 *   agent; the history stays readable.
 * - `kind_not_offered`: a permission answer the agent didn't offer. The app answers with an offered kind.
 * - `unknown_harness` and the RepoErrorCode codes: `POST /agents` with a harness or repo that doesn't exist.
 * - `auth_required`: `POST /agents` when the harness needs a login. The app tells the user to log in.
 * - `agent_failed`: `POST /agents` when the agent didn't start; as a summary's `error.code`, a turn that failed
 *   or a process that ended unexpectedly. The app shows the message and offers a new agent.
 * - `agent_error`: the agent refused a request (today only `POST /agents/:id/config`). The message ends with the
 *   agent's own; the app shows it, and the agent keeps running as it was.
 */
export const AgentErrorCode = z.enum([
  "not_found",
  "busy",
  "not_running",
  "kind_not_offered",
  "auth_required",
  "unknown_harness",
  ...RepoErrorCode.options,
  "agent_failed",
  "agent_error",
]);
export type AgentErrorCode = z.infer<typeof AgentErrorCode>;

/**
 * `POST /proposals/:id/approve` and `/reject`: `proposal_not_found` for an unknown proposal id,
 * `proposal_not_pending` for one already decided. The app refetches the proposals.
 */
export const ProposalErrorCode = z.enum(["proposal_not_found", "proposal_not_pending"]);
export type ProposalErrorCode = z.infer<typeof ProposalErrorCode>;

/**
 * The items routes' error codes: `items_not_configured` when the service runs without an items root (the app hides
 * the items views), `structure_not_found` and `item_not_found` for an unknown structure id or handle (the app
 * refetches the structures). The proposal routes add the ProposalErrorCode codes. `items_not_writable` is reserved
 * for a write the items root's filesystem can't take; no route sends it yet: such a failure on approve answers
 * `internal_error`.
 */
export const ItemsErrorCode = z.enum([
  "items_not_configured",
  "structure_not_found",
  "item_not_found",
  "items_not_writable",
  ...ProposalErrorCode.options,
]);
export type ItemsErrorCode = z.infer<typeof ItemsErrorCode>;

/**
 * Why the item writer refused a write; nothing on disk changed. Internal to the service, never sent. On /mcp the
 * access module turns each one but `items_not_writable` into an AccessErrorCode refusal (the agent gets its message);
 * approving a proposal turns them into a `conflict` proposal. `items_not_writable` fails the call: /mcp answers the
 * agent with a generic failure, approve answers `internal_error`.
 */
export const ItemWriteErrorCode = z.enum([
  "stale_version",
  "invalid_fields",
  "item_not_found",
  "structure_not_found",
  "field_not_writable",
  "items_not_writable",
]);
export type ItemWriteErrorCode = z.infer<typeof ItemWriteErrorCode>;

/**
 * Why /mcp refused an agent's items tool call: `not_found` (no such item or structure the agent may see),
 * `read_only`, `use_propose` or `use_edit` (the structure's level calls for another tool), `locked` (a locked field),
 * `stale_version` (the item changed since the agent read it), `invalid_fields` (the values don't fit the structure).
 * The agent gets only the message, which says what to do next; the app never sees these.
 */
export const AccessErrorCode = z.enum([
  "not_found",
  "read_only",
  "use_propose",
  "use_edit",
  "locked",
  "stale_version",
  "invalid_fields",
]);
export type AccessErrorCode = z.infer<typeof AccessErrorCode>;

/** Every error code the service uses; `errorResponse` sends only these. */
export const ErrorCode = z.union([
  ServerErrorCode,
  AgentErrorCode,
  ItemsErrorCode,
  ItemWriteErrorCode,
  AccessErrorCode,
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * `startedAt` (when the service started) and `codeId` (codeIdOf the checkout it runs) are optional: a service from
 * before they were added answers without them.
 */
export const VersionResponse = z.object({ apiVersion: z.int(), startedAt: Timestamp.exactOptional(), codeId: z.string().exactOptional() });
export type VersionResponse = z.infer<typeof VersionResponse>;

export const ListHarnessesResponse = z.array(z.object({ id: z.string(), name: z.string() }));
export type ListHarnessesResponse = z.infer<typeof ListHarnessesResponse>;

/** The folders an agent may start in: the workspace root (`path: "."`) first, then its git repos by name. */
export const ListReposResponse = z.object({ repos: z.array(z.object({ path: z.string(), name: z.string() })) });
export type ListReposResponse = z.infer<typeof ListReposResponse>;

// Newer ACP tool kinds read as "other".
const ToolKind = z
  .enum(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"])
  .catch("other");

/**
 * An open permission request, as the agent list shows it. `title` and `kind` come from the request's tool call, else
 * from the latest stored `tool_call`/`tool_call_update` with its id, else `""` and `"other"`; `at` is its
 * `permission_requested` entry's time.
 */
const PendingPermission = z.object({ requestId: z.string(), at: Timestamp, title: z.string(), kind: ToolKind });

/** What an agent is doing in its turn; `title` is the running tool's, left out when it has none. See `activityOf`. */
export const Activity = z.object({ kind: z.enum(["thinking", "writing", "tool"]), title: z.string().exactOptional() });
export type Activity = z.infer<typeof Activity>;

const AgentSummaryFields = z.object({
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
  /**
   * The agent folder's current local branch, read when the agent starts and at each turn's end. Absent outside a git
   * repo, on a detached HEAD, or when the read failed.
   */
  branch: z.string().exactOptional(),
  /**
   * A short excerpt of the latest agent message's text (whitespace folded, trimmed). Current at least each time a
   * turn ends; replaced, not appended, by the next message, and cleared when the latest message has no text (an
   * image only). Absent until the agent sends text.
   */
  lastText: z.string().exactOptional(),
  /** When the service last accepted a message or a permission answer from the app; never cleared. */
  lastUserAt: Timestamp.exactOptional(),
  /**
   * What the agent is doing while its state is `working` (by `activityOf` over its stored log), else null. A kind
   * this app doesn't know reads as null; absent in summaries from before the field.
   */
  activity: Activity.nullable().catch(null).exactOptional(),
  /**
   * The agent's open permission requests, oldest first. A row appears when the agent asks and leaves when the request
   * is answered, the turn is cancelled or ends, or the agent stops or exits; a service restart clears them all.
   * `[]` when reading a summary from before the field existed.
   */
  pendingPermissions: z.array(PendingPermission).default([]),
  /**
   * Whether the agent's process runs, whatever its state (a done agent, or an error one after a failed turn, may
   * still have one): what Stop and the quit count go by. True once the process runs and the summary is stored;
   * false once the process ends (stopped, exited or crashed) and for every agent a restarted service loads. When
   * reading a summary from before the field existed, true if the agent is running (see `isRunning`), so the app
   * still offers Stop and asks before quitting.
   */
  hasProcess: z.boolean(),
});

export const AgentSummary = z.preprocess(
  (value: unknown): unknown =>
    typeof value === "object" && value !== null && (value as { hasProcess?: unknown }).hasProcess === undefined
      ? { ...value, hasProcess: isRunning(value as Pick<z.infer<typeof AgentSummaryFields>, "state">) }
      : value,
  AgentSummaryFields,
);
export type AgentSummary = z.infer<typeof AgentSummary>;

/** Whether the agent waits on the user: the one rule for the app's "needs me" list and its waiting notifications. */
export const isWaiting = (agent: Pick<AgentSummary, "state"> | undefined): boolean => agent?.state === "waiting";

/**
 * Whether the agent is busy (working, or waiting on the user): the one rule for when a chat's turn and requests can
 * still be live. Whether it has a process (what Stop and the quit count go by) is `hasProcess`.
 */
export const isRunning = (agent: Pick<AgentSummary, "state"> | undefined): boolean => agent?.state === "working" || agent?.state === "waiting";

/**
 * The agents whose process runs (`hasProcess`, done ones too): the ones a stop or a quit ends. The one rule for the
 * quit, stop and restart questions, the "still running" notification and the status bar.
 */
export const agentsWithProcess = <T extends Pick<AgentSummary, "hasProcess">>(agents: readonly T[]): T[] => agents.filter((agent) => agent.hasProcess);

/** "1 agent", "2 agents": how many agents, wherever the app counts them. */
export const agentCountLabel = (count: number): string => `${String(count)} ${count === 1 ? "agent" : "agents"}`;

/**
 * A permission request's title: its own tool call's, else its tool's (the latest tool call with its id), else `""`.
 * An empty own title counts as none. The one rule for the agent list's open requests and the chat's request cards.
 */
export const permissionTitle = (own: string | null | undefined, toolTitle: string | null | undefined): string =>
  own === undefined || own === null || own === "" ? (toolTitle ?? "") : own;

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

/**
 * A tool call's fields. `tool_call` requires the id and title and may leave out the rest; `tool_call_update` (and a
 * permission request's tool call) requires only the id, and any other field may also be null.
 */
const toolCallFields = {
  toolCallId: z.string(),
  title: z.string(),
  kind: ToolKind,
  status: z.unknown(),
  content: knownItems(ToolCallContent),
  locations: knownItems(ToolCallLocation),
  rawInput: z.unknown(),
  rawOutput: z.unknown(),
};
const { toolCallId, title, ...toolCallDetails } = toolCallFields;

const nullable = <T extends Record<string, z.ZodType>>(fields: T) =>
  Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.nullable()])) as {
    [K in keyof T]: z.ZodNullable<T[K]>;
  };

const toolCallUpdateFields = {
  toolCallId,
  ...z.object(nullable({ title, ...toolCallDetails })).exactPartial().shape,
};
const ToolCallUpdateFields = z.object(toolCallUpdateFields).transform(knownStatus(ToolCallStatus.nullable()));

const contentChunkFields = { messageId: z.string().nullable().exactOptional(), content: ContentBlock };

/** A plan entry; newer ACP priorities read as "medium", newer statuses as "pending". */
const PlanEntry = z.object({
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]).catch("medium"),
  status: z.enum(["pending", "in_progress", "completed"]).catch("pending"),
});

/** Reads ACP's null optional fields (`keys`) as absent. */
const nullsAbsent = <T extends z.ZodType>(keys: readonly string[], schema: T) =>
  z.preprocess((value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const copy: Record<string, unknown> = { ...value };
    for (const key of keys) if (copy[key] === null) delete copy[key];
    return copy;
  }, schema);

const SelectOption = nullsAbsent(["description"], z.object({ value: z.string(), name: z.string(), description: z.string().exactOptional() }));
const SelectGroup = z.object({ group: z.string(), name: z.string(), options: z.array(SelectOption) });

const configOptionFields = { id: z.string(), name: z.string(), description: z.string().exactOptional(), category: z.string().exactOptional() };
const KNOWN_CONFIG_TYPES = new Set<unknown>(["select", "boolean"]);

/**
 * One of the agent's settings (ACP v1 `SessionConfigOption`): a select (flat values or groups), a boolean, or a type
 * newer than this app, kept with its id, name and value so the app can show it read-only.
 */
export const ConfigOption = nullsAbsent(
  ["description", "category"],
  z.union([
    z.object({
      ...configOptionFields,
      type: z.literal("select"),
      currentValue: z.string(),
      options: z.union([z.array(SelectOption), z.array(SelectGroup)]),
    }),
    z.object({ ...configOptionFields, type: z.literal("boolean"), currentValue: z.boolean() }),
    z.object({
      ...configOptionFields,
      type: z.string().refine((type) => !KNOWN_CONFIG_TYPES.has(type)),
      currentValue: z.unknown().exactOptional(),
    }),
  ]),
);
export type ConfigOption = z.infer<typeof ConfigOption>;

type SelectConfigOption = Extract<ConfigOption, { type: "select" }>;
type SelectValue = z.infer<typeof SelectOption>;
type SelectValueGroup = z.infer<typeof SelectGroup>;

/** Every value a select option takes, in the agent's order, whether its options are flat or in groups. */
export const selectValues = (option: Pick<SelectConfigOption, "options">): SelectValue[] =>
  option.options.flatMap((entry): SelectValue[] => ("group" in entry ? entry.options : [entry]));

/** A select option's groups, or undefined when its options are flat (or there are none). */
export const selectGroups = (option: Pick<SelectConfigOption, "options">): SelectValueGroup[] | undefined => {
  const groups = option.options.filter((entry): entry is SelectValueGroup => "group" in entry);
  return groups.length === 0 ? undefined : groups;
};

export const SessionUpdate = z.discriminatedUnion("sessionUpdate", [
  z.object({ sessionUpdate: z.literal("agent_message_chunk"), ...contentChunkFields }),
  /** The agent's reasoning, shaped as a message chunk. */
  z.object({ sessionUpdate: z.literal("agent_thought_chunk"), ...contentChunkFields }),
  /** The agent's whole current plan: each one replaces the last. */
  z.object({ sessionUpdate: z.literal("plan"), entries: z.array(PlanEntry) }),
  z
    .object({
      sessionUpdate: z.literal("tool_call"),
      toolCallId,
      title,
      ...z.object(toolCallDetails).exactPartial().shape,
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
  /** The agent's whole current list of settings: each one replaces the last. */
  z.object({ sessionUpdate: z.literal("config_option_update"), configOptions: z.array(ConfigOption) }),
]);
export type SessionUpdate = z.infer<typeof SessionUpdate>;

// Items and proposals (lenient), read by the app; the shapes live in `items.ts`.

/** `GET /structures`: every structure under the items root, hidden ones and broken settings included. */
export const ListStructuresResponse = z.object({ structures: z.array(StructureSummary) });
export type ListStructuresResponse = z.infer<typeof ListStructuresResponse>;

/** `GET /structures/:id/items`: every file of the structure, invalid ones included. */
export const ListItemsResponse = z.object({ items: z.array(ItemSummary) });
export type ListItemsResponse = z.infer<typeof ListItemsResponse>;

/** `GET /items/:handle`: one item by handle or alias, with its body. */
export const GetItemResponse = Item;
export type GetItemResponse = z.infer<typeof GetItemResponse>;

/** `GET /proposals`: the proposals matching ListProposalsQuery. */
export const ListProposalsResponse = z.object({ proposals: z.array(Proposal) });
export type ListProposalsResponse = z.infer<typeof ListProposalsResponse>;

// Log entries (lenient): an agent's stored history, read through `GET /agents/:id/log`.

const logEntryFields = { seq: Seq, agentId: z.string(), at: Timestamp };

/**
 * The stop reasons the service itself writes in `turn_ended`, besides ACP's: "error" (the turn failed) and "stopped"
 * (the agent's process ended during the turn).
 */
export const SERVICE_STOP_REASON = { error: "error", stopped: "stopped" } as const;

/** The ACP session an update or permission request came from; one agent may run more than one (sub-agents). */
const SessionId = z.string().exactOptional();

export const LogEntry = z.discriminatedUnion("type", [
  z.object({
    ...logEntryFields,
    type: z.literal("user_message"),
    text: z.string(),
    commandId: z.string().exactOptional(),
  }),
  z.object({ ...logEntryFields, type: z.literal("session_update"), sessionId: SessionId, update: SessionUpdate }),
  z.object({
    ...logEntryFields,
    type: z.literal("permission_requested"),
    sessionId: SessionId,
    requestId: z.string(),
    toolCall: ToolCallUpdateFields,
    options: knownItems(z.object({ kind: PermissionKind, name: z.string() })),
  }),
  z.object({
    ...logEntryFields,
    type: z.literal("permission_answered"),
    sessionId: SessionId,
    requestId: z.string(),
    kind: PermissionKind,
  }),
  /**
   * Ends each turn. Besides ACP's stop reasons, the service writes those in `SERVICE_STOP_REASON`. Older logs may
   * lack these two, leaving such a turn without an end.
   */
  z.object({ ...logEntryFields, type: z.literal("turn_ended"), stopReason: z.string().min(1) }),
]);
export type LogEntry = z.infer<typeof LogEntry>;

const logEntryTypes = new Set<unknown>(LogEntry.options.map((option) => option.shape.type.value));
const updateKinds: Record<SessionUpdate["sessionUpdate"], true> = {
  agent_message_chunk: true,
  agent_thought_chunk: true,
  plan: true,
  tool_call: true,
  tool_call_update: true,
  session_info_update: true,
  usage_update: true,
  available_commands_update: true,
  config_option_update: true,
};

/** An entry of a type, or carrying a session update kind, that this app doesn't know (newer service). */
const isUnknownLogEntry = (data: unknown) => {
  if (typeof data !== "object" || data === null) return false;
  const { type, update } = data as { type?: unknown; update?: unknown };
  if (typeof type === "string" && !logEntryTypes.has(type)) return true;
  if (type === "session_update" && typeof update === "object" && update !== null) {
    const updateKind = (update as { sessionUpdate?: unknown }).sessionUpdate;
    return typeof updateKind === "string" && !Object.hasOwn(updateKinds, updateKind);
  }
  return false;
};

/**
 * Parses one entry from the service. Returns undefined for entry types and session update
 * kinds this app doesn't know (newer service); throws on a malformed known entry.
 */
export const parseLogEntry = (data: unknown): LogEntry | undefined => (isUnknownLogEntry(data) ? undefined : LogEntry.parse(data));

export const ListLogResponse = z.object({
  dbId: DbId,
  seq: Seq,
  // Unknown entries are dropped as parseLogEntry would; a malformed known one fails the parse.
  entries: z
    .array(z.unknown())
    .transform((entries) => entries.filter((value) => !isUnknownLogEntry(value)))
    .pipe(z.array(LogEntry)),
  truncated: z.boolean(),
});
export type ListLogResponse = z.infer<typeof ListLogResponse>;

// Alerts (lenient), sent over `GET /events` after the change is committed.

/** How often the service writes the heartbeat on every open `GET /events` stream; a client may drop a stream silent for longer. */
export const HEARTBEAT_MS = 15_000;

/** The alert type of a proposal change; the other alert types are the agent ones. */
export const PROPOSAL_ALERT = "proposal";

const AgentAlertType = z.enum(["agent_added", "agent_changed", "agent_removed", "log"]);

/**
 * Says that something changed, up to `seq`; the app fetches the change. An agent alert names the agent, a
 * `proposal` alert the proposal. Alerts carry ids only: unknown fields are stripped, so an alert never carries
 * agent or item content even if one is sent.
 */
export const Alert = z.discriminatedUnion("type", [
  z.object({
    seq: Seq,
    dbId: DbId,
    type: AgentAlertType,
    agentId: z.string(),
  }),
  z.object({ seq: Seq, dbId: DbId, type: z.literal(PROPOSAL_ALERT), proposalId: z.string() }),
]);
export type Alert = z.infer<typeof Alert>;

const alertTypes = new Set<unknown>([...AgentAlertType.options, PROPOSAL_ALERT]);

/** Parses one alert. Returns undefined for alert types this app doesn't know (newer service); throws on a malformed known alert. */
export const parseAlert = (data: unknown): Alert | undefined => {
  if (typeof data === "object" && data !== null) {
    const { type } = data as { type?: unknown };
    if (typeof type === "string" && !alertTypes.has(type)) return undefined;
  }
  return Alert.parse(data);
};
