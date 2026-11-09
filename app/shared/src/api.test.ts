// The wire contract: requests, responses, entries read through the API, and alerts on the stream.
import type { SessionUpdate as AcpSessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  AgentSummary,
  Alert,
  AnswerPermissionRequest,
  ErrorBody,
  ListAgentsResponse,
  ListHarnessesResponse,
  ListLogQuery,
  ListLogResponse,
  SendMessageRequest,
  SessionUpdate,
  StartAgentRequest,
  VersionResponse,
  parseAlert,
  parseLogEntry,
} from "./api.ts";
import type { LogEntry } from "./api.ts";

// Invented samples in the shapes the service and claude-agent-acp really produce.

const doneAgent = {
  id: "agt_7f3c2a",
  harness: "claude-code",
  repo: "site-web",
  state: "done",
  sessionId: "sess_01JBX4Q9M2",
  title: "Tidy the header styles",
  capabilities: { loadSession: true },
  startedAt: "2026-11-04T09:15:00.000Z",
  lastActivityAt: "2026-11-04T09:21:42.512Z",
};

const dbId = "db_5c1e9a0f7b2d";
const agentId = doneAgent.id;
const at = "2026-11-09T10:02:11.120Z";

const agentMessageChunk = {
  sessionUpdate: "agent_message_chunk",
  messageId: "msg_1",
  content: { type: "text", text: "I'll start by reading the header component." },
};

const toolCall = {
  sessionUpdate: "tool_call",
  toolCallId: "toolu_01A",
  title: "Edit src/components/header/header.tsx",
  kind: "edit",
  status: "pending",
  locations: [{ path: "/work/site-web/src/components/header/header.tsx", line: 12 }],
  rawInput: {
    file_path: "/work/site-web/src/components/header/header.tsx",
    old_string: "px-4",
    new_string: "px-6",
  },
};

const diffContent = {
  type: "diff",
  path: "/work/site-web/src/components/header/header.tsx",
  oldText: '<header className="px-4">',
  newText: '<header className="px-6">',
};

const toolCallUpdate = {
  sessionUpdate: "tool_call_update",
  toolCallId: "toolu_01A",
  status: "completed",
  content: [diffContent],
};

const toolCallUpdateNewFile = {
  sessionUpdate: "tool_call_update",
  toolCallId: "toolu_01B",
  status: "completed",
  content: [{ type: "diff", path: "/work/site-web/NOTES.md", oldText: null, newText: "# Notes\n" }],
};

const sessionInfoUpdate = {
  sessionUpdate: "session_info_update",
  title: "Tidy the header styles",
  updatedAt: "2026-11-04T09:16:03.000Z",
};

const usageUpdate = {
  sessionUpdate: "usage_update",
  used: 18_250,
  size: 200_000,
  cost: { amount: 0.42, currency: "USD" },
};

const availableCommandsUpdate = {
  sessionUpdate: "available_commands_update",
  availableCommands: [
    { name: "review", description: "Review the current changes" },
    { name: "test", description: "Run the tests", input: { hint: "test name pattern" } },
  ],
};

const renderedUpdates = [
  agentMessageChunk,
  toolCall,
  toolCallUpdate,
  toolCallUpdateNewFile,
  sessionInfoUpdate,
  usageUpdate,
  availableCommandsUpdate,
];

/** An entry as the log route sends it: `seq`, `type`, `agentId`, `at`, plus the type's fields. */
const logEntry = (seq: number, type: string, fields: Record<string, unknown> = {}) => ({ seq, type, agentId, at, ...fields });

const permissionToolCall = {
  toolCallId: "toolu_01A",
  title: "Edit src/components/header/header.tsx",
  kind: "edit",
  content: [diffContent],
};

const permissionRequested = logEntry(20, "permission_requested", {
  requestId: "perm_3",
  toolCall: permissionToolCall,
  options: [
    { kind: "allow_once", name: "Allow" },
    { kind: "allow_always", name: "Always allow" },
    { kind: "reject_once", name: "Reject" },
  ],
});

const sampleLogEntries = [
  logEntry(1, "user_message", { text: "Make the header padding match the footer." }),
  logEntry(2, "user_message", { text: "Also check the mobile breakpoint.", commandId: "cmd_01JC2" }),
  ...renderedUpdates.map((update, i) => logEntry(10 + i, "session_update", { update })),
  permissionRequested,
  logEntry(21, "permission_answered", { requestId: "perm_3", kind: "allow_once" }),
  logEntry(22, "turn_ended", { stopReason: "end_turn" }),
  logEntry(23, "turn_ended", { stopReason: "cancelled" }),
  { ...logEntry(24, "turn_ended", { stopReason: "end_turn" }), at: "2026-11-09T11:02:11.120+01:00" }, // offset allowed, as in AgentSummary
];

const alertTypes = ["agent_added", "agent_changed", "agent_removed", "log"] as const;

const without = (value: object, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));

const permissionKinds = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;

describe("request bodies (strict)", () => {
  test("StartAgentRequest accepts a harness id and a relative repo path", () => {
    for (const repo of ["site-web", "libs/shared-ui", "services/api/v2", ".config-repo", "release..notes"]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, repo).toBe(true);
    }
  });

  test("StartAgentRequest accepts \".\" as the workspace root", () => {
    expect(StartAgentRequest.safeParse({ harness: "claude-code", repo: "." }).success).toBe(true);
  });

  test("StartAgentRequest rejects empty, ./, trailing-slash, empty and . segments in repo paths", () => {
    for (const repo of ["", "./site-web", "./", "site-web/", "libs//shared-ui", "libs/./shared-ui", "site-web/.", "/."]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, JSON.stringify(repo)).toBe(false);
    }
  });

  test("StartAgentRequest rejects absolute, .. and backslash repo paths", () => {
    for (const repo of [
      "/home/dev/site-web",
      "/",
      "..",
      "../other-project",
      "site-web/..",
      "site-web/../../etc",
      "libs/../..",
      "site-web\\src",
      "..\\other-project",
      "C:\\work\\site-web",
    ]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, repo).toBe(false);
    }
  });

  test("StartAgentRequest rejects control characters in repo paths", () => {
    for (const repo of ["site\u0000web", "site-web\n", "site-web\r", "libs\tshared-ui", "\u001b[31msite-web", "site\u001fweb"]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, JSON.stringify(repo)).toBe(false);
    }
  });

  test("StartAgentRequest rejects unknown fields such as a command or args", () => {
    for (const extra of [{ command: "/bin/sh" }, { args: ["-c", "true"] }, { env: { FOO: "bar" } }]) {
      const body = { harness: "claude-code", repo: "site-web", ...extra };
      expect(StartAgentRequest.safeParse(body).success, JSON.stringify(extra)).toBe(false);
    }
  });

  test("StartAgentRequest rejects missing fields", () => {
    expect(StartAgentRequest.safeParse({ harness: "claude-code" }).success).toBe(false);
    expect(StartAgentRequest.safeParse({ repo: "site-web" }).success).toBe(false);
    expect(StartAgentRequest.safeParse({}).success).toBe(false);
  });

  test("SendMessageRequest accepts prompt text and rejects empty, missing or extra", () => {
    expect(SendMessageRequest.safeParse({ text: "Make the header padding match the footer." }).success).toBe(true);
    expect(SendMessageRequest.safeParse({ text: "" }).success).toBe(false);
    for (const text of [" ", "   ", "\n", "\t \n"]) {
      expect(SendMessageRequest.safeParse({ text }).success, JSON.stringify(text)).toBe(false);
    }
    expect(SendMessageRequest.safeParse({}).success).toBe(false);
    expect(SendMessageRequest.safeParse({ text: "hi", attachments: [] }).success).toBe(false);
  });

  test("SendMessageRequest keeps a commandId of 1-64 letters, digits, - or _", () => {
    for (const commandId of ["c", "cmd_01JC2", "A-b_9", "3f2b8c1e-7a4d-4e1b-9c0a-2d5e6f7a8b9c", "x".repeat(64)]) {
      expect(SendMessageRequest.parse({ text: "Run the tests.", commandId }), commandId).toEqual({
        text: "Run the tests.",
        commandId,
      });
    }
  });

  test("SendMessageRequest's commandId is optional", () => {
    const parsed = SendMessageRequest.parse({ text: "Run the tests." });
    expect(parsed).not.toHaveProperty("commandId");
  });

  test("SendMessageRequest rejects a commandId that is empty, too long, has other characters or isn't a string", () => {
    for (const commandId of ["", "x".repeat(65), "cmd 1", "cmd.1", "cmd/1", "cmd:1", "cmd\n", "é", 42, null]) {
      expect(SendMessageRequest.safeParse({ text: "Run the tests.", commandId }).success, JSON.stringify(commandId)).toBe(
        false,
      );
    }
  });

  test("SendMessageRequest stays strict with a commandId", () => {
    for (const extra of [{ attachments: [] }, { requestId: "r1" }, { command_id: "cmd_1" }]) {
      const body = { text: "Run the tests.", commandId: "cmd_01JC2", ...extra };
      expect(SendMessageRequest.safeParse(body).success, JSON.stringify(extra)).toBe(false);
    }
  });

  test("AnswerPermissionRequest accepts each permission kind", () => {
    for (const kind of permissionKinds) {
      expect(AnswerPermissionRequest.safeParse({ kind }).success, kind).toBe(true);
    }
  });

  test("AnswerPermissionRequest rejects unknown kinds, an optionId and extra fields", () => {
    for (const body of [
      { kind: "allow" },
      { kind: "ALLOW_ONCE" },
      { kind: "" },
      {},
      { optionId: "opt_allow" },
      { kind: "allow_once", optionId: "opt_allow" },
    ]) {
      expect(AnswerPermissionRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

// `GET /agents/:id/log?after=&limit=`, read from query-string values.
describe("ListLogQuery (strict, from query strings)", () => {
  test("after defaults to 0 and limit stays absent", () => {
    const parsed = ListLogQuery.parse({});
    expect(parsed).toEqual({ after: 0 });
    expect(parsed).not.toHaveProperty("limit");
  });

  test("after and limit are read as integers from strings", () => {
    expect(ListLogQuery.parse({ after: "17", limit: "50" })).toEqual({ after: 17, limit: 50 });
    expect(ListLogQuery.parse({ after: "0" })).toEqual({ after: 0 });
  });

  test("limit accepts 1 to 1000", () => {
    for (const limit of ["1", "1000"]) {
      expect(ListLogQuery.parse({ limit }), limit).toMatchObject({ limit: Number(limit) });
    }
  });

  test("after rejects negative, non-integer and non-numeric values", () => {
    for (const after of ["-1", "1.5", "abc", "1e400"]) {
      expect(ListLogQuery.safeParse({ after }).success, after).toBe(false);
    }
  });

  test("limit rejects values outside 1-1000, non-integers and non-numbers", () => {
    for (const limit of ["0", "1001", "-3", "2.5", "abc"]) {
      expect(ListLogQuery.safeParse({ limit }).success, limit).toBe(false);
    }
  });

  test("plain numbers are read as well as numeric strings", () => {
    expect(ListLogQuery.parse({ after: 17, limit: 50 })).toEqual({ after: 17, limit: 50 });
  });

  test("an empty value for after or limit is rejected, not read as 0", () => {
    for (const query of [{ after: "" }, { limit: "" }, { after: " " }]) {
      expect(ListLogQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  test("a repeated key (an array value) is rejected", () => {
    expect(ListLogQuery.safeParse({ after: "3" }).success).toBe(true); // control: a single value parses
    for (const query of [{ after: ["3", "5"] }, { limit: ["10", "20"] }, { after: ["3"] }]) {
      expect(ListLogQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  test("unknown query keys are rejected", () => {
    for (const query of [{ before: "3" }, { after: "1", cursor: "x" }]) {
      expect(ListLogQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});

describe("responses (lenient)", () => {
  test("VersionResponse reads the api version and ignores unknown fields", () => {
    expect(VersionResponse.parse({ apiVersion: 1 })).toMatchObject({ apiVersion: 1 });
    expect(VersionResponse.parse({ apiVersion: 1, build: "dev" })).toMatchObject({ apiVersion: 1 });
    expect(VersionResponse.safeParse({}).success).toBe(false);
  });

  test("ListHarnessesResponse reads id and name per harness", () => {
    const body = [{ id: "claude-code", name: "Claude Code", icon: "claude.svg" }];
    expect(ListHarnessesResponse.parse(body)).toMatchObject([{ id: "claude-code", name: "Claude Code" }]);
    expect(ListHarnessesResponse.parse([])).toEqual([]);
    expect(ListHarnessesResponse.safeParse([{ id: "claude-code" }]).success).toBe(false);
  });

  test("AgentSummary accepts a realistic summary in every state, including stopped", () => {
    for (const state of ["working", "waiting", "done", "error", "stopped"]) {
      expect(AgentSummary.safeParse({ ...doneAgent, state }).success, state).toBe(true);
    }
    expect(AgentSummary.safeParse(without(doneAgent, "title")).success).toBe(true);
  });

  test("AgentSummary carries an error in the error body's shape", () => {
    // Reading: `error?` is the inner `{ code, message, hint? }` of the error body (flagged to the lead).
    const failed = {
      ...doneAgent,
      state: "error",
      error: {
        code: "auth_required",
        message: "Claude Code is not logged in.",
        hint: "Run `claude /login` in a terminal, then start the agent again.",
      },
    };
    expect(AgentSummary.parse(failed)).toMatchObject({ state: "error", error: { code: "auth_required" } });
  });

  test("AgentSummary ignores unknown fields, including unknown capabilities", () => {
    const newer = {
      ...doneAgent,
      model: "some-model",
      capabilities: { loadSession: false, promptCapabilities: { image: true } },
    };
    expect(AgentSummary.parse(newer)).toMatchObject({
      id: doneAgent.id,
      capabilities: { loadSession: false },
    });
  });

  test("AgentSummary rejects missing required fields and non-ISO timestamps", () => {
    for (const field of ["id", "harness", "repo", "state", "sessionId", "capabilities", "startedAt", "lastActivityAt"]) {
      expect(AgentSummary.safeParse(without(doneAgent, field)).success, field).toBe(false);
    }
    expect(AgentSummary.safeParse({ ...doneAgent, capabilities: {} }).success).toBe(false);
    expect(AgentSummary.safeParse({ ...doneAgent, startedAt: "yesterday" }).success).toBe(false);
  });

  test("AgentSummary rejects a state outside the contract states", () => {
    for (const state of ["paused", "idle", "Stopped", ""]) {
      expect(AgentSummary.safeParse({ ...doneAgent, state }).success, state).toBe(false);
    }
  });

  test("AgentSummary's state is exactly the five contract states", () => {
    expectTypeOf<AgentSummary["state"]>().toEqualTypeOf<"working" | "waiting" | "done" | "error" | "stopped">();
  });

  test("ListAgentsResponse reads dbId, seq and the agents", () => {
    const parsed = ListAgentsResponse.parse({ dbId, seq: 42, agents: [doneAgent], server: "x" });
    expect(parsed).toMatchObject({ dbId, seq: 42 });
    expect(parsed.agents).toHaveLength(1);
    expect(ListAgentsResponse.parse({ dbId, seq: 0, agents: [] }).agents).toEqual([]);
  });

  test("ListAgentsResponse requires a non-empty dbId and a seq", () => {
    for (const body of [
      { seq: 42, agents: [doneAgent] },
      { dbId: "", seq: 42, agents: [doneAgent] },
      { dbId: 7, seq: 42, agents: [doneAgent] },
      { dbId, agents: [doneAgent] },
    ]) {
      expect(ListAgentsResponse.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  test("ErrorBody accepts errors with and without a hint and ignores unknown fields", () => {
    expect(ErrorBody.safeParse({ error: { code: "agent_busy", message: "The agent is still working." } }).success).toBe(
      true,
    );
    expect(
      ErrorBody.parse({
        error: { code: "auth_required", message: "Not logged in.", hint: "Run `claude /login`.", docs: "x" },
        requestId: "r1",
      }),
    ).toMatchObject({ error: { code: "auth_required", hint: "Run `claude /login`." } });
  });

  test("ErrorBody rejects a body without code or message", () => {
    for (const body of [{}, { error: {} }, { error: { code: "x" } }, { error: { message: "x" } }, { message: "x" }]) {
      expect(ErrorBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("LogEntry (lenient)", () => {
  test("parseLogEntry reads a realistic sample of every entry type unchanged", () => {
    for (const sample of sampleLogEntries) {
      expect(parseLogEntry(sample), `${sample.type} ${sample.seq}`).toEqual(sample);
    }
  });

  test("a user message without a commandId has no commandId key", () => {
    const parsed = parseLogEntry(logEntry(1, "user_message", { text: "Make the header padding match the footer." }));
    expect(parsed).toMatchObject({ type: "user_message", text: "Make the header padding match the footer." });
    expect(parsed).not.toHaveProperty("commandId");
  });

  test("session updates and permission entries keep the ACP sessionId they arrived with, and have no sessionId key without one", () => {
    const carriers = [
      logEntry(10, "session_update", { update: agentMessageChunk }),
      permissionRequested,
      logEntry(21, "permission_answered", { requestId: "perm_3", kind: "allow_once" }),
    ];
    for (const carrier of carriers) {
      const withSession = { ...carrier, sessionId: "sess_01JBX4Q9M2" };
      expect(parseLogEntry(withSession), carrier.type).toEqual(withSession);
      expect(ListLogResponse.parse({ dbId, seq: 30, entries: [withSession], truncated: false }).entries, carrier.type).toEqual([
        withSession,
      ]);
      expect(parseLogEntry(carrier), carrier.type).not.toHaveProperty("sessionId");
      expect(() => parseLogEntry({ ...carrier, sessionId: 42 }), `${carrier.type} with a numeric sessionId`).toThrow();
    }
  });

  test("parseLogEntry keeps diff content on tool call updates", () => {
    expect(parseLogEntry(logEntry(7, "session_update", { update: toolCallUpdate }))).toMatchObject({
      update: { sessionUpdate: "tool_call_update", content: [diffContent] },
    });
  });

  test("parseLogEntry ignores entries of types it doesn't know, agent state included", () => {
    for (const type of ["state_changed", "assistant_message", "future_type"]) {
      expect(parseLogEntry(logEntry(30, type, { text: "x", state: "done" })), type).toBeUndefined();
    }
  });

  test("parseLogEntry ignores session updates of kinds we don't render", () => {
    for (const update of [
      { sessionUpdate: "plan", entries: [{ content: "Read the header", priority: "high", status: "pending" }] },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking about padding." } },
      { sessionUpdate: "some_future_kind" },
    ]) {
      expect(parseLogEntry(logEntry(40, "session_update", { update })), update.sessionUpdate).toBeUndefined();
    }
  });

  test("parseLogEntry accepts any non-empty stopReason and rejects an empty one", () => {
    for (const stopReason of ["end_turn", "max_tokens", "refusal", "some_future_reason"]) {
      expect(parseLogEntry(logEntry(41, "turn_ended", { stopReason })), stopReason).toMatchObject({ type: "turn_ended", stopReason });
    }
    expect(() => parseLogEntry(logEntry(41, "turn_ended", { stopReason: "" }))).toThrow();
  });

  test("parseLogEntry drops unknown permission option kinds and keeps the known ones", () => {
    const parsed = parseLogEntry(
      logEntry(42, "permission_requested", {
        requestId: "perm_4",
        toolCall: { toolCallId: "toolu_01C", title: "Run pnpm test", kind: "execute" },
        options: [
          { kind: "allow_once", name: "Allow" },
          { kind: "allow_for_session", name: "Allow for this session" },
          { kind: "reject_once", name: "Reject" },
        ],
      }),
    );
    expect(parsed).toMatchObject({ type: "permission_requested", requestId: "perm_4" });
    expect(parsed?.type === "permission_requested" ? parsed.options : undefined).toEqual([
      { kind: "allow_once", name: "Allow" },
      { kind: "reject_once", name: "Reject" },
    ]);
  });

  test("parseLogEntry drops unknown tool call content items and keeps the update", () => {
    const content = [diffContent, { type: "terminal", terminalId: "term_1" }];
    for (const update of [
      { ...toolCall, content },
      { ...toolCallUpdate, content },
    ]) {
      const parsed = parseLogEntry(logEntry(43, "session_update", { update }));
      expect(parsed, update.sessionUpdate).toMatchObject({ update: { sessionUpdate: update.sessionUpdate } });
      const kept = parsed?.type === "session_update" ? parsed.update : undefined;
      expect(kept && "content" in kept ? kept.content : undefined, update.sessionUpdate).toEqual([diffContent]);
    }
  });

  test("parseLogEntry ignores unknown fields on known entries and updates", () => {
    expect(
      parseLogEntry({
        ...logEntry(30, "session_update", { update: { ...usageUpdate, _meta: { vendor: "x" }, cacheHits: 3 } }),
        origin: "store",
      }),
    ).toMatchObject({ seq: 30, agentId, at, update: { sessionUpdate: "usage_update" } });
    expect(parseLogEntry({ ...logEntry(31, "turn_ended", { stopReason: "end_turn" }), durationMs: 812 })).toMatchObject({
      type: "turn_ended",
      stopReason: "end_turn",
    });
  });

  test("parseLogEntry rejects malformed known entries", () => {
    const turnEnded = logEntry(1, "turn_ended", { stopReason: "end_turn" });
    expect(parseLogEntry(turnEnded)).toBeDefined(); // control: the well-formed entry parses
    for (const bad of [
      without(turnEnded, "seq"),
      { ...turnEnded, seq: -1 },
      { ...turnEnded, seq: 1.5 },
      { ...turnEnded, seq: "3" },
      without(turnEnded, "agentId"),
      without(turnEnded, "at"),
      { ...turnEnded, at: "yesterday" },
      logEntry(1, "user_message"), // no text
      logEntry(1, "user_message", { text: 42 }),
      logEntry(1, "permission_answered", { requestId: "p", kind: "allow" }),
      logEntry(1, "permission_answered", { kind: "allow_once" }), // no requestId
      logEntry(1, "permission_answered", { requestId: "p" }), // no permission kind
      without(permissionRequested, "toolCall"),
      logEntry(1, "session_update"), // no update
      logEntry(1, "session_update", { update: { sessionUpdate: "usage_update", used: "lots" } }),
      logEntry(1, "session_update", { update: { sessionUpdate: "tool_call_update", content: [diffContent] } }), // no toolCallId
    ]) {
      expect(() => parseLogEntry(bad), JSON.stringify(bad)).toThrow();
    }
  });

  test("parseLogEntry rejects input that is not an entry at all", () => {
    expect(parseLogEntry(sampleLogEntries[0])).toBeDefined(); // control: an entry parses
    for (const bad of [null, undefined, "turn_ended", 42, [], {}, { seq: 1 }]) {
      expect(() => parseLogEntry(bad), JSON.stringify(bad)).toThrow();
    }
  });

  test("parseLogEntry's result is the LogEntry union", () => {
    expectTypeOf(parseLogEntry).returns.toEqualTypeOf<LogEntry | undefined>();
    expectTypeOf<LogEntry["type"]>().toEqualTypeOf<
      "user_message" | "session_update" | "permission_requested" | "permission_answered" | "turn_ended"
    >();
    expectTypeOf<Extract<LogEntry, { type: "permission_answered" }>["kind"]>().toEqualTypeOf<
      "allow_once" | "allow_always" | "reject_once" | "reject_always"
    >();
  });
});

describe("ListLogResponse (lenient)", () => {
  const known = sampleLogEntries.slice(0, 3);
  const unknownType = logEntry(5, "state_changed", { state: "done" });
  const unknownUpdate = logEntry(6, "session_update", { update: { sessionUpdate: "plan", entries: [] } });

  test("reads dbId, seq, entries and truncated", () => {
    for (const truncated of [false, true]) {
      const parsed = ListLogResponse.parse({ dbId, seq: 99, entries: known, truncated });
      expect(parsed, String(truncated)).toEqual({ dbId, seq: 99, entries: known, truncated });
    }
    expect(ListLogResponse.parse({ dbId, seq: 0, entries: [], truncated: false }).entries).toEqual([]);
  });

  test("drops entries it doesn't know and keeps the others in order", () => {
    const [first, second, third] = known;
    const parsed = ListLogResponse.parse({
      dbId,
      seq: 99,
      entries: [first, unknownType, second, unknownUpdate, third],
      truncated: false,
    });
    expect(parsed.entries).toEqual([first, second, third]);
  });

  test("fails on a malformed known entry", () => {
    const body = { dbId, seq: 99, entries: [...known, logEntry(7, "turn_ended", { stopReason: "" })], truncated: false };
    expect(ListLogResponse.safeParse(body).success).toBe(false);
  });

  test("ignores unknown fields", () => {
    expect(ListLogResponse.parse({ dbId, seq: 99, entries: known, truncated: false, nextAfter: 12 })).toMatchObject({
      dbId,
      seq: 99,
    });
  });

  test("requires a non-empty dbId, seq, entries and a boolean truncated", () => {
    const body = { dbId, seq: 99, entries: known, truncated: false };
    expect(ListLogResponse.safeParse(body).success).toBe(true); // control: the full body parses
    for (const field of ["dbId", "seq", "entries", "truncated"]) {
      expect(ListLogResponse.safeParse(without(body, field)).success, field).toBe(false);
    }
    expect(ListLogResponse.safeParse({ ...body, seq: -1 }).success).toBe(false);
    expect(ListLogResponse.safeParse({ ...body, dbId: "" }).success).toBe(false);
    expect(ListLogResponse.safeParse({ ...body, truncated: "false" }).success).toBe(false);
  });
});

describe("alerts (lenient)", () => {
  const alert = (type: string, seq = 60) => ({ seq, dbId, type, agentId });

  test("parseAlert reads every alert type", () => {
    for (const type of alertTypes) {
      expect(parseAlert(alert(type)), type).toEqual(alert(type));
    }
  });

  // Lasting invariant: desktop notifications are built from alerts, so an alert must never carry agent
  // content, even when the service (by a bug) sends some. Mutation check: make Alert pass unknown fields through.
  test("no agent content in alerts: content fields sent with an alert are stripped", () => {
    const content = {
      update: agentMessageChunk,
      text: "Make the header padding match the footer.",
      agent: doneAgent,
      entries: sampleLogEntries,
      title: "Tidy the header styles",
      toolCall: permissionToolCall,
      error: { code: "auth_required", message: "Not logged in." },
    };
    for (const type of alertTypes) {
      const sent = { ...alert(type), ...content };
      for (const [via, parsed] of [
        ["parseAlert", parseAlert(sent)],
        ["Alert.parse", Alert.parse(sent)],
      ] as const) {
        expect(parsed, `${via} ${type}`).toEqual(alert(type));
        expect(Object.keys(parsed ?? {}).sort(), `${via} ${type}`).toEqual(["agentId", "dbId", "seq", "type"]);
      }
    }
  });

  test("no agent content in alerts: an agent alert has only seq, dbId, type and agentId", () => {
    expectTypeOf<keyof Exclude<Alert, { type: "proposal" }>>().toEqualTypeOf<"seq" | "dbId" | "type" | "agentId">();
  });

  test("parseAlert ignores alert types it doesn't know", () => {
    for (const type of ["agent_paused", "heartbeat", "future_thing"]) {
      expect(parseAlert(alert(type)), type).toBeUndefined();
    }
  });

  test("parseAlert rejects malformed known alerts, and agentId is required on every type", () => {
    for (const type of alertTypes) {
      expect(parseAlert(alert(type)), type).toBeDefined(); // control: the well-formed alert parses
      for (const field of ["seq", "dbId", "agentId"]) {
        expect(() => parseAlert(without(alert(type), field)), `${type} without ${field}`).toThrow();
      }
      for (const bad of [
        { ...alert(type), seq: -1 },
        { ...alert(type), seq: 1.5 },
        { ...alert(type), seq: "3" },
        { ...alert(type), agentId: 7 },
        { ...alert(type), dbId: 7 },
        { ...alert(type), dbId: "" },
      ]) {
        expect(() => parseAlert(bad), JSON.stringify(bad)).toThrow();
      }
    }
  });

  test("parseAlert rejects input that is not an alert at all", () => {
    expect(parseAlert(alert("log"))).toBeDefined(); // control: an alert parses
    for (const bad of [null, undefined, "log", 42, [], {}, { seq: 1 }]) {
      expect(() => parseAlert(bad), JSON.stringify(bad)).toThrow();
    }
  });

  test("parseAlert's result is the Alert union", () => {
    expectTypeOf(parseAlert).returns.toEqualTypeOf<Alert | undefined>();
    expectTypeOf<Alert["type"]>().toEqualTypeOf<"agent_added" | "agent_changed" | "agent_removed" | "log" | "proposal">();
  });

  // A proposal alert tells the app to refetch proposals; like agent alerts it carries ids only, so a proposed
  // title or body never reaches a desktop notification. Agent alerts keep needing agentId.
  test("a proposal alert parses with ids only; unknown types are still ignored; agent alerts still need agentId", () => {
    const proposal = { seq: 61, dbId, type: "proposal", proposalId: "prp_0196f3c2" };
    const content = { agentId, title: "Login times out", fields: { body: "Steps: …" }, reason: "Seen twice" };
    for (const [via, parsed] of [
      ["parseAlert", parseAlert({ ...proposal, ...content })],
      ["Alert.parse", Alert.parse({ ...proposal, ...content })],
    ] as const) {
      expect(parsed, via).toEqual(proposal);
    }
    expect(() => parseAlert(without(proposal, "proposalId"))).toThrow();
    expect(parseAlert({ ...proposal, type: "proposal_changed" })).toBeUndefined();
    for (const type of alertTypes) {
      expect(() => parseAlert({ seq: 62, dbId, type, proposalId: proposal.proposalId }), type).toThrow();
    }
  });
});

// ACP-derived values the app tolerates: one tool call reaches the app on three entry paths.
const toolCallFields = without(toolCall, "sessionUpdate");

const toolCallPaths = [
  {
    path: "session_update tool_call",
    logEntry: (fields: Record<string, unknown>) => logEntry(50, "session_update", { update: { ...toolCall, ...fields } }),
    pick: (parsed: LogEntry | undefined): unknown => (parsed?.type === "session_update" ? parsed.update : undefined),
  },
  {
    path: "session_update tool_call_update",
    logEntry: (fields: Record<string, unknown>) => logEntry(51, "session_update", { update: { ...toolCallUpdate, ...fields } }),
    pick: (parsed: LogEntry | undefined): unknown => (parsed?.type === "session_update" ? parsed.update : undefined),
  },
  {
    path: "permission_requested toolCall",
    logEntry: (fields: Record<string, unknown>) =>
      logEntry(52, "permission_requested", {
        requestId: "perm_5",
        toolCall: { ...toolCallFields, ...fields },
        options: [{ kind: "allow_once", name: "Allow" }],
      }),
    pick: (parsed: LogEntry | undefined): unknown => (parsed?.type === "permission_requested" ? parsed.toolCall : undefined),
  },
];

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const supportedImages = ["image/png", "image/jpeg", "image/webp", "image/gif"].map((mimeType) => ({
  type: "image",
  mimeType,
  data: pixel,
}));

// Content blocks the app doesn't render, and the `original` their placeholder names.
const unsupportedBlocks = [
  { block: { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz48L3N2Zz4=" }, original: "image" },
  { block: { type: "image", mimeType: "image/bmp", data: "Qk0=" }, original: "image" },
  { block: { type: "audio", mimeType: "audio/wav", data: "UklGRiQ=" }, original: "audio" },
  {
    block: { type: "resource_link", name: "header.tsx", uri: "file:///work/site-web/src/components/header/header.tsx" },
    original: "resource_link",
  },
  { block: { type: "resource", resource: { uri: "file:///work/site-web/NOTES.md", text: "# Notes\n" } }, original: "resource" },
  { block: { type: "video", uri: "file:///work/site-web/demo.mp4" }, original: "video" },
];

const chunkEntry = (content: unknown) =>
  logEntry(53, "session_update", { update: { sessionUpdate: "agent_message_chunk", content } });

const chunkContentOf = (block: unknown): unknown => {
  const parsed = parseLogEntry(chunkEntry(block));
  return parsed?.type === "session_update" && "content" in parsed.update ? parsed.update.content : undefined;
};

const toolContentOf = (entry: (typeof toolCallPaths)[number], content: unknown[]): unknown[] =>
  (entry.pick(parseLogEntry(entry.logEntry({ content }))) as { content: unknown[] }).content;

// A content block the app doesn't render reads as the same placeholder in a message chunk and on every tool call path.
const expectPlaceholderEverywhere = (block: unknown, original: string) => {
  const placeholder = { type: "unsupported", original };
  expect(chunkContentOf(block), `chunk ${JSON.stringify(block)}`).toEqual(placeholder);
  for (const entry of toolCallPaths) {
    expect(toolContentOf(entry, [diffContent, { type: "content", content: block }]), `${entry.path} ${JSON.stringify(block)}`).toEqual([
      diffContent,
      { type: "content", content: placeholder },
    ]);
  }
};

describe("ACP-derived values (tolerated)", () => {
  test("an image in a supported format is kept in an agent message chunk", () => {
    for (const image of supportedImages) {
      expect(parseLogEntry(chunkEntry(image)), image.mimeType).toMatchObject({
        update: { sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: image.mimeType, data: image.data } },
      });
    }
  });

  test("other non-text agent message content becomes an unsupported placeholder", () => {
    for (const { block, original } of unsupportedBlocks) {
      const parsed = parseLogEntry(chunkEntry(block));
      const update = parsed?.type === "session_update" ? parsed.update : undefined;
      expect(update, JSON.stringify(block)).toMatchObject({ sessionUpdate: "agent_message_chunk" });
      expect(update && "content" in update ? update.content : undefined, JSON.stringify(block)).toEqual({
        type: "unsupported",
        original,
      });
    }
  });

  test("an unknown tool kind reads as other and an unknown status is dropped", () => {
    for (const { path, logEntry: make, pick } of toolCallPaths) {
      const parsed = pick(parseLogEntry(make({ kind: "browse", status: "queued" })));
      expect(parsed, path).toMatchObject({ toolCallId: "toolu_01A", kind: "other" });
      expect(parsed, path).not.toHaveProperty("status");
    }
  });

  test("a malformed tool call location is dropped and the others are kept", () => {
    const locations = [{ path: "/work/site-web/a.ts", line: 3 }, { line: 5 }, { path: 42 }, { path: "/work/site-web/b.ts" }];
    for (const { path, logEntry: make, pick } of toolCallPaths) {
      const parsed = pick(parseLogEntry(make({ locations })));
      expect(parsed, path).toMatchObject({
        locations: [{ path: "/work/site-web/a.ts", line: 3 }, { path: "/work/site-web/b.ts" }],
      });
      expect((parsed as { locations: unknown[] }).locations, path).toHaveLength(2);
    }
  });

  test("a known tool status survives on every path", () => {
    for (const { path, logEntry: make, pick } of toolCallPaths) {
      for (const status of ["pending", "in_progress", "completed", "failed"]) {
        expect(pick(parseLogEntry(make({ status }))), `${path} ${status}`).toMatchObject({ status });
      }
    }
  });

  test("an image in a supported format is kept in tool call content on every path", () => {
    for (const image of supportedImages) {
      const content = [diffContent, { type: "content", content: image }];
      for (const { path, logEntry: make, pick } of toolCallPaths) {
        const parsed = pick(parseLogEntry(make({ content })));
        expect((parsed as { content: unknown[] }).content, `${path} ${image.mimeType}`).toMatchObject([
          diffContent,
          { type: "content", content: { type: "image", mimeType: image.mimeType, data: image.data } },
        ]);
      }
    }
  });

  test("other non-text tool call content becomes an unsupported placeholder on every path", () => {
    for (const { block, original } of unsupportedBlocks) {
      const content = [diffContent, { type: "terminal", terminalId: "term_1" }, { type: "content", content: block }];
      for (const { path, logEntry: make, pick } of toolCallPaths) {
        const parsed = pick(parseLogEntry(make({ content })));
        expect((parsed as { content: unknown[] }).content, `${path} ${JSON.stringify(block)}`).toEqual([
          diffContent,
          { type: "content", content: { type: "unsupported", original } },
        ]);
      }
    }
  });

  test("an image without non-empty base64 data becomes an unsupported image placeholder", () => {
    for (const block of [
      { type: "image", mimeType: "image/png", data: "" },
      { type: "image", mimeType: "image/png", data: '"><script>alert(1)</script>' },
      { type: "image", mimeType: "image/png" },
      { type: "image", mimeType: "image/png", data: 42 },
    ]) {
      expectPlaceholderEverywhere(block, "image");
    }
  });

  test("an image with a mimeType outside the exact supported list becomes an unsupported image placeholder", () => {
    for (const block of [
      { type: "image", mimeType: "image/PNG", data: pixel },
      { type: "image", mimeType: "image/png; charset=x", data: pixel },
      { type: "image", mimeType: "image/svg+xml", data: pixel },
      { type: "image", mimeType: "", data: pixel, uri: "https://example.invalid/shot.png" },
    ]) {
      expectPlaceholderEverywhere(block, "image");
    }
  });

  test("a kept image loses its uri", () => {
    const image = { type: "image", mimeType: "image/png", data: pixel, uri: "https://example.invalid/shot.png" };
    expect(chunkContentOf(image)).toMatchObject({ type: "image", mimeType: "image/png", data: pixel });
    expect(chunkContentOf(image)).not.toHaveProperty("uri");
    for (const entry of toolCallPaths) {
      const [, kept] = toolContentOf(entry, [diffContent, { type: "content", content: image }]);
      expect(kept, entry.path).toMatchObject({ type: "content", content: { type: "image", data: pixel } });
      expect((kept as { content: unknown }).content, entry.path).not.toHaveProperty("uri");
    }
  });

  test("the placeholder names the block type only when it is a short lowercase identifier", () => {
    for (const [type, original] of [
      ["resource_link", "resource_link"],
      ["a".repeat(32), "a".repeat(32)],
      ["a".repeat(33), "unknown"],
      ["<img src=x onerror=alert(1)>", "unknown"],
      ["Video", "unknown"],
      ["video-clip", "unknown"],
      ["resource\u0000link", "unknown"],
      ["audio\n", "unknown"],
      ["", "unknown"],
    ] as const) {
      expectPlaceholderEverywhere({ type, uri: "file:///work/site-web/x" }, original);
    }
  });

  test("a malformed text block throws in a message chunk but is dropped from tool call content", () => {
    expect(() => parseLogEntry(chunkEntry({ type: "text" }))).toThrow();
    for (const entry of toolCallPaths) {
      expect(toolContentOf(entry, [diffContent, { type: "content", content: { type: "text" } }]), entry.path).toEqual([
        diffContent,
      ]);
    }
  });

  test("a command whose input has an unknown shape is kept with a null input", () => {
    const parsed = parseLogEntry(
      logEntry(54, "session_update", {
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "deploy", description: "Deploy a preview", input: { schema: {} } },
            { name: "test", description: "Run the tests", input: { hint: "test name pattern" } },
            { name: "review", description: "Review the current changes" },
          ],
        },
      }),
    );
    expect(parsed).toMatchObject({
      update: {
        availableCommands: [
          { name: "deploy", description: "Deploy a preview", input: null },
          { name: "test", description: "Run the tests", input: { hint: "test name pattern" } },
          { name: "review", description: "Review the current changes" },
        ],
      },
    });
    const commands =
      parsed?.type === "session_update" && "availableCommands" in parsed.update ? parsed.update.availableCommands : [];
    expect(commands[2]).not.toHaveProperty("input");
  });
});

describe("session updates", () => {
  test("SessionUpdate accepts a realistic sample of each rendered kind", () => {
    for (const update of renderedUpdates) {
      expect(SessionUpdate.safeParse(update).success, update.sessionUpdate).toBe(true);
    }
  });

  test("SessionUpdate covers exactly the six rendered kinds", () => {
    expectTypeOf<SessionUpdate["sessionUpdate"]>().toEqualTypeOf<
      | "agent_message_chunk"
      | "tool_call"
      | "tool_call_update"
      | "session_info_update"
      | "usage_update"
      | "available_commands_update"
    >();
  });

  // Type-level: `pnpm typecheck` fails if what we keep from ACP stops being assignable to the SDK's types.
  // The `unsupported` placeholder is ours, not ACP's, so it is removed (at any depth) before comparing.
  type Ours<K extends SessionUpdate["sessionUpdate"]> = Extract<SessionUpdate, { sessionUpdate: K }>;
  type Acp<K extends SessionUpdate["sessionUpdate"]> = Extract<AcpSessionUpdate, { sessionUpdate: K }>;
  type FromAcp<T> = T extends { type: "unsupported" }
    ? never
    : T extends readonly (infer Element)[]
      ? FromAcp<Element>[]
      : T extends object
        ? { [K in keyof T]: FromAcp<T[K]> }
        : T;

  test("each rendered update kind, minus our placeholder, is assignable to the ACP SDK's SessionUpdate", () => {
    expectTypeOf<FromAcp<Ours<"agent_message_chunk">>>().toExtend<Acp<"agent_message_chunk">>();
    expectTypeOf<FromAcp<Ours<"tool_call">>>().toExtend<Acp<"tool_call">>();
    expectTypeOf<FromAcp<Ours<"tool_call_update">>>().toExtend<Acp<"tool_call_update">>();
    expectTypeOf<FromAcp<Ours<"session_info_update">>>().toExtend<Acp<"session_info_update">>();
    expectTypeOf<FromAcp<Ours<"usage_update">>>().toExtend<Acp<"usage_update">>();
    expectTypeOf<FromAcp<Ours<"available_commands_update">>>().toExtend<Acp<"available_commands_update">>();
    expectTypeOf<FromAcp<SessionUpdate>>().toExtend<AcpSessionUpdate>();
  });

  test("the session update an entry carries is the SessionUpdate schema's type", () => {
    expectTypeOf<Extract<LogEntry, { type: "session_update" }>["update"]>().toEqualTypeOf<SessionUpdate>();
  });

  test("message and tool call content can carry the unsupported placeholder", () => {
    type Placeholder = { type: "unsupported"; original: string };
    type ToolContentItem = NonNullable<Ours<"tool_call_update">["content"]>[number];
    expectTypeOf<Placeholder>().toExtend<Ours<"agent_message_chunk">["content"]>();
    expectTypeOf<{ type: "content"; content: Placeholder }>().toExtend<ToolContentItem>();
  });
});
