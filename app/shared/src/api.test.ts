// Task 1 (wire contract): every test in this file belongs to step 4, task 1.
import type { SessionUpdate as AcpSessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  AgentSummary,
  AnswerPermissionRequest,
  ErrorBody,
  ListAgentsResponse,
  ListHarnessesResponse,
  SendMessageRequest,
  SessionUpdate,
  StartAgentRequest,
  VersionResponse,
  parseServiceEvent,
} from "./api.ts";
import type { ServiceEvent } from "./api.ts";

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

const sampleEvents = [
  { seq: 1, type: "snapshot", agents: [doneAgent] },
  { seq: 2, type: "snapshot", agents: [] },
  { seq: 3, type: "agent_added", agent: doneAgent },
  { seq: 4, type: "agent_changed", agent: { ...doneAgent, state: "working" } },
  { seq: 5, type: "agent_removed", agentId: "agt_7f3c2a" },
  ...renderedUpdates.map((update, i) => ({
    seq: 10 + i,
    type: "session_update",
    agentId: "agt_7f3c2a",
    update,
  })),
  {
    seq: 20,
    type: "permission_requested",
    agentId: "agt_7f3c2a",
    requestId: "perm_3",
    toolCall: {
      toolCallId: "toolu_01A",
      title: "Edit src/components/header/header.tsx",
      kind: "edit",
      content: [diffContent],
    },
    options: [
      { kind: "allow_once", name: "Allow" },
      { kind: "allow_always", name: "Always allow" },
      { kind: "reject_once", name: "Reject" },
    ],
  },
  { seq: 21, type: "permission_answered", agentId: "agt_7f3c2a", requestId: "perm_3", kind: "allow_once" },
  { seq: 22, type: "turn_ended", agentId: "agt_7f3c2a", stopReason: "end_turn" },
  { seq: 23, type: "turn_ended", agentId: "agt_7f3c2a", stopReason: "cancelled" },
];

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

  test("AgentSummary accepts a realistic summary in every state", () => {
    for (const state of ["working", "waiting", "done", "error"]) {
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

  test("AgentSummary rejects a state outside the four contract states", () => {
    for (const state of ["paused", "idle", ""]) {
      expect(AgentSummary.safeParse({ ...doneAgent, state }).success, state).toBe(false);
    }
  });

  test("AgentSummary's state is exactly the four contract states", () => {
    expectTypeOf<AgentSummary["state"]>().toEqualTypeOf<"working" | "waiting" | "done" | "error">();
  });

  test("ListAgentsResponse reads seq and the agents", () => {
    const parsed = ListAgentsResponse.parse({ seq: 42, agents: [doneAgent] });
    expect(parsed.seq).toBe(42);
    expect(parsed.agents).toHaveLength(1);
    expect(ListAgentsResponse.parse({ seq: 0, agents: [] }).agents).toEqual([]);
    expect(ListAgentsResponse.safeParse({ agents: [doneAgent] }).success).toBe(false);
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

describe("events (lenient)", () => {
  test("parseServiceEvent accepts a realistic sample of every event type", () => {
    for (const sample of sampleEvents) {
      const event = parseServiceEvent(sample);
      expect(event, sample.type).toBeDefined();
      expect(event).toMatchObject({ seq: sample.seq, type: sample.type });
    }
  });

  test("parseServiceEvent keeps diff content on tool call updates", () => {
    const event = parseServiceEvent({ seq: 7, type: "session_update", agentId: "agt_7f3c2a", update: toolCallUpdate });
    expect(event).toMatchObject({ update: { sessionUpdate: "tool_call_update", content: [diffContent] } });
  });

  test("parseServiceEvent ignores session updates of kinds we don't render", () => {
    for (const update of [
      { sessionUpdate: "plan", entries: [{ content: "Read the header", priority: "high", status: "pending" }] },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking about padding." } },
      { sessionUpdate: "some_future_kind" },
    ]) {
      const event = { seq: 40, type: "session_update", agentId: "agt_7f3c2a", update };
      expect(parseServiceEvent(event), update.sessionUpdate).toBeUndefined();
    }
  });

  test("parseServiceEvent accepts any non-empty stopReason and rejects an empty one", () => {
    for (const stopReason of ["end_turn", "max_tokens", "refusal", "some_future_reason"]) {
      const event = parseServiceEvent({ seq: 41, type: "turn_ended", agentId: "agt_7f3c2a", stopReason });
      expect(event, stopReason).toMatchObject({ type: "turn_ended", stopReason });
    }
    expect(() => parseServiceEvent({ seq: 41, type: "turn_ended", agentId: "agt_7f3c2a", stopReason: "" })).toThrow();
  });

  test("parseServiceEvent drops unknown permission option kinds and keeps the known ones", () => {
    const event = parseServiceEvent({
      seq: 42,
      type: "permission_requested",
      agentId: "agt_7f3c2a",
      requestId: "perm_4",
      toolCall: { toolCallId: "toolu_01C", title: "Run pnpm test", kind: "execute" },
      options: [
        { kind: "allow_once", name: "Allow" },
        { kind: "allow_for_session", name: "Allow for this session" },
        { kind: "reject_once", name: "Reject" },
      ],
    });
    expect(event).toMatchObject({ type: "permission_requested", requestId: "perm_4" });
    expect(event?.type === "permission_requested" ? event.options : undefined).toEqual([
      { kind: "allow_once", name: "Allow" },
      { kind: "reject_once", name: "Reject" },
    ]);
  });

  test("parseServiceEvent drops unknown tool call content items and keeps the update", () => {
    const content = [diffContent, { type: "terminal", terminalId: "term_1" }];
    for (const update of [
      { ...toolCall, content },
      { ...toolCallUpdate, content },
    ]) {
      const event = parseServiceEvent({ seq: 43, type: "session_update", agentId: "agt_7f3c2a", update });
      expect(event, update.sessionUpdate).toMatchObject({ update: { sessionUpdate: update.sessionUpdate } });
      const parsed = event?.type === "session_update" ? event.update : undefined;
      expect(parsed && "content" in parsed ? parsed.content : undefined, update.sessionUpdate).toEqual([diffContent]);
    }
  });

  test("parseServiceEvent ignores unknown event types", () => {
    for (const type of ["agent_paused", "heartbeat", "future_thing"]) {
      expect(parseServiceEvent({ seq: 99, type, agentId: "agt_7f3c2a" }), type).toBeUndefined();
    }
  });

  test("parseServiceEvent ignores unknown fields on known events and updates", () => {
    const event = parseServiceEvent({
      seq: 30,
      type: "session_update",
      agentId: "agt_7f3c2a",
      origin: "replay",
      update: { ...usageUpdate, _meta: { vendor: "x" }, cacheHits: 3 },
    });
    expect(event).toMatchObject({ seq: 30, agentId: "agt_7f3c2a", update: { sessionUpdate: "usage_update" } });
    expect(parseServiceEvent({ seq: 31, type: "agent_removed", agentId: "agt_7f3c2a", reason: "deleted" })).toMatchObject(
      { type: "agent_removed", agentId: "agt_7f3c2a" },
    );
  });

  test("parseServiceEvent rejects malformed known events", () => {
    for (const bad of [
      { type: "agent_removed", agentId: "agt_7f3c2a" }, // no seq
      { seq: -1, type: "agent_removed", agentId: "agt_7f3c2a" },
      { seq: 1.5, type: "agent_removed", agentId: "agt_7f3c2a" },
      { seq: "3", type: "agent_removed", agentId: "agt_7f3c2a" },
      { seq: 1, type: "agent_added" }, // no agent
      { seq: 1, type: "agent_added", agent: { id: "agt_7f3c2a" } }, // not a summary
      { seq: 1, type: "permission_answered", agentId: "a", requestId: "p", kind: "allow" },
      { seq: 1, type: "session_update", agentId: "a", update: { sessionUpdate: "usage_update", used: "lots" } },
      {
        seq: 1,
        type: "session_update",
        agentId: "a",
        update: { sessionUpdate: "tool_call_update", content: [diffContent] }, // no toolCallId
      },
    ]) {
      expect(() => parseServiceEvent(bad), JSON.stringify(bad)).toThrow();
    }
  });

  test("parseServiceEvent rejects input that is not an event at all", () => {
    for (const bad of [null, undefined, "snapshot", 42, [], {}, { seq: 1 }]) {
      expect(() => parseServiceEvent(bad), JSON.stringify(bad)).toThrow();
    }
  });

  test("parseServiceEvent's result is the ServiceEvent union", () => {
    expectTypeOf(parseServiceEvent).returns.toEqualTypeOf<ServiceEvent | undefined>();
    expectTypeOf<ServiceEvent["type"]>().toEqualTypeOf<
      | "snapshot"
      | "agent_added"
      | "agent_changed"
      | "agent_removed"
      | "session_update"
      | "permission_requested"
      | "permission_answered"
      | "turn_ended"
    >();
  });
});

// ACP-derived values the app tolerates: one tool call reaches the app on three paths.
const toolCallFields = without(toolCall, "sessionUpdate");

const toolCallPaths = [
  {
    path: "session_update tool_call",
    event: (fields: Record<string, unknown>) => ({
      seq: 50,
      type: "session_update",
      agentId: "agt_7f3c2a",
      update: { ...toolCall, ...fields },
    }),
    pick: (event: ServiceEvent | undefined): unknown => (event?.type === "session_update" ? event.update : undefined),
  },
  {
    path: "session_update tool_call_update",
    event: (fields: Record<string, unknown>) => ({
      seq: 51,
      type: "session_update",
      agentId: "agt_7f3c2a",
      update: { ...toolCallUpdate, ...fields },
    }),
    pick: (event: ServiceEvent | undefined): unknown => (event?.type === "session_update" ? event.update : undefined),
  },
  {
    path: "permission_requested toolCall",
    event: (fields: Record<string, unknown>) => ({
      seq: 52,
      type: "permission_requested",
      agentId: "agt_7f3c2a",
      requestId: "perm_5",
      toolCall: { ...toolCallFields, ...fields },
      options: [{ kind: "allow_once", name: "Allow" }],
    }),
    pick: (event: ServiceEvent | undefined): unknown =>
      event?.type === "permission_requested" ? event.toolCall : undefined,
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

const chunkEvent = (content: unknown) => ({
  seq: 53,
  type: "session_update",
  agentId: "agt_7f3c2a",
  update: { sessionUpdate: "agent_message_chunk", content },
});

const chunkContentOf = (block: unknown): unknown => {
  const event = parseServiceEvent(chunkEvent(block));
  return event?.type === "session_update" && "content" in event.update ? event.update.content : undefined;
};

const toolContentOf = (entry: (typeof toolCallPaths)[number], content: unknown[]): unknown[] =>
  (entry.pick(parseServiceEvent(entry.event({ content }))) as { content: unknown[] }).content;

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
      const event = parseServiceEvent(chunkEvent(image));
      expect(event, image.mimeType).toMatchObject({
        update: { sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: image.mimeType, data: image.data } },
      });
    }
  });

  test("other non-text agent message content becomes an unsupported placeholder", () => {
    for (const { block, original } of unsupportedBlocks) {
      const event = parseServiceEvent(chunkEvent(block));
      const update = event?.type === "session_update" ? event.update : undefined;
      expect(update, JSON.stringify(block)).toMatchObject({ sessionUpdate: "agent_message_chunk" });
      expect(update && "content" in update ? update.content : undefined, JSON.stringify(block)).toEqual({
        type: "unsupported",
        original,
      });
    }
  });

  test("an unknown tool kind reads as other and an unknown status is dropped", () => {
    for (const { path, event, pick } of toolCallPaths) {
      const parsed = pick(parseServiceEvent(event({ kind: "browse", status: "queued" })));
      expect(parsed, path).toMatchObject({ toolCallId: "toolu_01A", kind: "other" });
      expect(parsed, path).not.toHaveProperty("status");
    }
  });

  test("a malformed tool call location is dropped and the others are kept", () => {
    const locations = [{ path: "/work/site-web/a.ts", line: 3 }, { line: 5 }, { path: 42 }, { path: "/work/site-web/b.ts" }];
    for (const { path, event, pick } of toolCallPaths) {
      const parsed = pick(parseServiceEvent(event({ locations })));
      expect(parsed, path).toMatchObject({
        locations: [{ path: "/work/site-web/a.ts", line: 3 }, { path: "/work/site-web/b.ts" }],
      });
      expect((parsed as { locations: unknown[] }).locations, path).toHaveLength(2);
    }
  });

  test("a known tool status survives on every path", () => {
    for (const { path, event, pick } of toolCallPaths) {
      for (const status of ["pending", "in_progress", "completed", "failed"]) {
        expect(pick(parseServiceEvent(event({ status }))), `${path} ${status}`).toMatchObject({ status });
      }
    }
  });

  test("an image in a supported format is kept in tool call content on every path", () => {
    for (const image of supportedImages) {
      const content = [diffContent, { type: "content", content: image }];
      for (const { path, event, pick } of toolCallPaths) {
        const parsed = pick(parseServiceEvent(event({ content })));
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
      for (const { path, event, pick } of toolCallPaths) {
        const parsed = pick(parseServiceEvent(event({ content })));
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
      const [, item] = toolContentOf(entry, [diffContent, { type: "content", content: image }]);
      expect(item, entry.path).toMatchObject({ type: "content", content: { type: "image", data: pixel } });
      expect((item as { content: unknown }).content, entry.path).not.toHaveProperty("uri");
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
    expect(() => parseServiceEvent(chunkEvent({ type: "text" }))).toThrow();
    for (const entry of toolCallPaths) {
      expect(toolContentOf(entry, [diffContent, { type: "content", content: { type: "text" } }]), entry.path).toEqual([
        diffContent,
      ]);
    }
  });

  test("a command whose input has an unknown shape is kept with a null input", () => {
    const event = parseServiceEvent({
      seq: 54,
      type: "session_update",
      agentId: "agt_7f3c2a",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "deploy", description: "Deploy a preview", input: { schema: {} } },
          { name: "test", description: "Run the tests", input: { hint: "test name pattern" } },
          { name: "review", description: "Review the current changes" },
        ],
      },
    });
    expect(event).toMatchObject({
      update: {
        availableCommands: [
          { name: "deploy", description: "Deploy a preview", input: null },
          { name: "test", description: "Run the tests", input: { hint: "test name pattern" } },
          { name: "review", description: "Review the current changes" },
        ],
      },
    });
    const commands = event?.type === "session_update" && "availableCommands" in event.update ? event.update.availableCommands : [];
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
    : T extends readonly (infer Item)[]
      ? FromAcp<Item>[]
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

  test("message and tool call content can carry the unsupported placeholder", () => {
    type Placeholder = { type: "unsupported"; original: string };
    type ToolContentItem = NonNullable<Ours<"tool_call_update">["content"]>[number];
    expectTypeOf<Placeholder>().toExtend<Ours<"agent_message_chunk">["content"]>();
    expectTypeOf<{ type: "content"; content: Placeholder }>().toExtend<ToolContentItem>();
  });
});
