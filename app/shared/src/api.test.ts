// The wire contract: requests, responses, entries read through the API, and alerts on the stream.
import type { SessionUpdate as AcpSessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  AgentSummary,
  Alert,
  ListLogResponse,
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

const agentThoughtChunk = {
  sessionUpdate: "agent_thought_chunk",
  messageId: "msg_1",
  content: { type: "text", text: "The footer uses px-6, so the header should too." },
};

const plan = {
  sessionUpdate: "plan",
  entries: [
    { content: "Read the header component", priority: "high", status: "completed" },
    { content: "Match the footer padding", priority: "medium", status: "in_progress" },
    { content: "Check the mobile breakpoint", priority: "low", status: "pending" },
  ],
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

// As claude-agent-acp sends them: a permission mode select with flat values, a model select with grouped values,
// and a boolean.
const configOptionUpdate = {
  sessionUpdate: "config_option_update",
  configOptions: [
    {
      type: "select",
      id: "mode",
      name: "Mode",
      category: "mode",
      currentValue: "default",
      options: [
        { value: "default", name: "Default", description: "Ask before edits and commands" },
        { value: "acceptEdits", name: "Accept edits" },
      ],
    },
    {
      type: "select",
      id: "model",
      name: "Model",
      description: "The model the agent runs on",
      category: "model",
      currentValue: "sonnet",
      options: [
        { group: "current", name: "Current", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
        { group: "older", name: "Older", options: [{ value: "haiku", name: "Haiku" }] },
      ],
    },
    { type: "boolean", id: "thinking", name: "Extended thinking", category: "thought_level", currentValue: true },
  ],
};

const renderedUpdates = [
  agentMessageChunk,
  agentThoughtChunk,
  plan,
  toolCall,
  toolCallUpdate,
  toolCallUpdateNewFile,
  sessionInfoUpdate,
  usageUpdate,
  availableCommandsUpdate,
  configOptionUpdate,
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

describe("request bodies (strict)", () => {
  test("StartAgentRequest takes a relative repo path inside the workspace, and nothing that could leave it or run something else", () => {
    for (const repo of [".", "site-web", "libs/shared-ui"]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, repo).toBe(true);
    }
    for (const repo of ["..", "site-web/../../etc", "/home/dev/site-web", "site-web\\src", "site\u0000web"]) {
      expect(StartAgentRequest.safeParse({ harness: "claude-code", repo }).success, JSON.stringify(repo)).toBe(false);
    }
    expect(StartAgentRequest.safeParse({ harness: "claude-code", repo: "site-web", command: "/bin/sh" }).success).toBe(false);
  });
});

describe("responses (lenient)", () => {

  test("a /version answer from before startedAt and codeId existed still parses", () => {
    expect(VersionResponse.parse({ apiVersion: 1 })).toEqual({ apiVersion: 1 });
  });

  test("an AgentSummary from before hasProcess existed has a process only while running", () => {
    const read = (state: AgentSummary["state"]) => AgentSummary.parse({ ...doneAgent, state }).hasProcess;
    expect(read("working")).toBe(true);
    expect(read("waiting")).toBe(true);
    expect(read("done")).toBe(false);
    expect(read("error")).toBe(false);
    expect(read("stopped")).toBe(false);
  });
});

describe("LogEntry (lenient)", () => {
  test("parseLogEntry reads a realistic sample of every entry type unchanged", () => {
    for (const sample of sampleLogEntries) {
      expect(parseLogEntry(sample), `${sample.type} ${sample.seq}`).toEqual(sample);
    }
  });

  test("parseLogEntry ignores entries of types it doesn't know, agent state included", () => {
    for (const type of ["state_changed", "assistant_message", "future_type"]) {
      expect(parseLogEntry(logEntry(30, type, { text: "x", state: "done" })), type).toBeUndefined();
    }
  });

  test("parseLogEntry ignores session updates of kinds we don't render", () => {
    for (const update of [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Match the footer." } },
      { sessionUpdate: "some_future_kind" },
    ]) {
      expect(parseLogEntry(logEntry(40, "session_update", { update })), update.sessionUpdate).toBeUndefined();
    }
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

  // Contract "Config options in the log" (lenient): the options come from the agent, so a newer ACP's option type must
  // not make the entry unreadable (the footer would go empty); it's kept, shown read-only, beside the others.
  // A later app reads the same stored log and may know the type, so every field the agent sent is kept, not only ours.
  test("a config option of a type this app doesn't know is kept with every field it came with, and so are its neighbours", () => {
    const [mode, model, thinking] = configOptionUpdate.configOptions;
    const newer = {
      type: "multi_select",
      id: "tools",
      name: "Allowed tools",
      currentValue: ["Read", "Edit"],
      options: [{ value: "Read", name: "Read" }],
      maxSelected: 3,
      layout: { columns: 2, compact: true },
    };
    const parsed = parseLogEntry(logEntry(44, "session_update", { update: { sessionUpdate: "config_option_update", configOptions: [mode, newer, model, thinking] } }));
    expect(parsed).toMatchObject({ update: { sessionUpdate: "config_option_update", configOptions: [mode, newer, model, thinking] } });
    const options = parsed?.type === "session_update" && parsed.update.sessionUpdate === "config_option_update" ? parsed.update.configOptions : [];
    expect(options).toHaveLength(4);
    expect(options[1]).toEqual(newer);
  });

  test("ACP nulls in config options read as absent", () => {
    const update = {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          description: null,
          category: null,
          currentValue: "sonnet",
          options: [{ value: "sonnet", name: "Sonnet", description: null }],
        },
        { type: "boolean", id: "fast", name: "Fast mode", description: null, category: null, currentValue: false },
      ],
    };
    const parsed = parseLogEntry(logEntry(45, "session_update", { update }));
    const options = parsed?.type === "session_update" && parsed.update.sessionUpdate === "config_option_update" ? parsed.update.configOptions : undefined;
    expect(options).toHaveLength(2);
    for (const option of options ?? []) {
      expect(option, option.id).not.toHaveProperty("description");
      expect(option, option.id).not.toHaveProperty("category");
    }
    const [select] = options ?? [];
    expect(select && "options" in select ? select.options : undefined).toEqual([{ value: "sonnet", name: "Sonnet" }]);
  });
});

describe("ListLogResponse (lenient)", () => {
  const known = sampleLogEntries.slice(0, 3);
  const unknownType = logEntry(5, "state_changed", { state: "done" });
  const unknownUpdate = logEntry(6, "session_update", { update: { sessionUpdate: "some_future_kind", entries: [] } });

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
});

describe("alerts (lenient)", () => {
  const alert = (type: string, seq = 60) => ({ seq, dbId, type, agentId });

  // Lasting invariant: desktop notifications are built from alerts, so an alert must never carry agent
  // content, even when the service (by a bug) sends some.
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

  test("parseAlert ignores alert types it doesn't know", () => {
    for (const type of ["agent_paused", "heartbeat", "future_thing"]) {
      expect(parseAlert(alert(type)), type).toBeUndefined();
    }
  });

  test("no agent content in alerts: a proposal alert keeps its ids only", () => {
    const proposal = { seq: 61, dbId, type: "proposal", proposalId: "prp_0196f3c2" };
    const content = { agentId, title: "Login times out", fields: { body: "Steps: …" }, reason: "Seen twice" };
    for (const [via, parsed] of [
      ["parseAlert", parseAlert({ ...proposal, ...content })],
      ["Alert.parse", Alert.parse({ ...proposal, ...content })],
    ] as const) {
      expect(parsed, via).toEqual(proposal);
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

  test("an unknown tool kind reads as other and an unknown status is dropped", () => {
    for (const { path, logEntry: make, pick } of toolCallPaths) {
      const parsed = pick(parseLogEntry(make({ kind: "browse", status: "queued" })));
      expect(parsed, path).toMatchObject({ toolCallId: "toolu_01A", kind: "other" });
      expect(parsed, path).not.toHaveProperty("status");
    }
  });

  test("an image without non-empty base64 data becomes an unsupported image placeholder", () => {
    for (const block of [
      { type: "image", mimeType: "image/png", data: '"><script>alert(1)</script>' },
      { type: "image", mimeType: "image/png" },
    ]) {
      expectPlaceholderEverywhere(block, "image");
    }
  });

  test("an image with a mimeType outside the exact supported list becomes an unsupported image placeholder", () => {
    for (const block of [
      { type: "image", mimeType: "image/png; charset=x", data: pixel },
      { type: "image", mimeType: "image/svg+xml", data: pixel },
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
});

describe("session updates", () => {
  // Type-level: `pnpm typecheck` fails if what we keep from ACP stops being assignable to the SDK's types.
  // Our own lenient branches aren't ACP's, so they are removed (at any depth) before comparing: the `unsupported`
  // placeholder, and a config option of a type we don't know (its `type` is any string, not a literal).
  type Ours<K extends SessionUpdate["sessionUpdate"]> = Extract<SessionUpdate, { sessionUpdate: K }>;
  type Acp<K extends SessionUpdate["sessionUpdate"]> = Extract<AcpSessionUpdate, { sessionUpdate: K }>;
  type FromAcp<T> = T extends { type: "unsupported" }
    ? never
    : T extends { type: infer Type extends string }
      ? string extends Type
        ? never
        : { [K in keyof T]: FromAcp<T[K]> }
      : T extends readonly (infer Element)[]
        ? FromAcp<Element>[]
        : T extends object
          ? { [K in keyof T]: FromAcp<T[K]> }
          : T;

  test("each rendered update kind, minus our placeholder, is assignable to the ACP SDK's SessionUpdate", () => {
    expectTypeOf<FromAcp<Ours<"agent_message_chunk">>>().toExtend<Acp<"agent_message_chunk">>();
    expectTypeOf<FromAcp<Ours<"agent_thought_chunk">>>().toExtend<Acp<"agent_thought_chunk">>();
    expectTypeOf<FromAcp<Ours<"plan">>>().toExtend<Acp<"plan">>();
    expectTypeOf<FromAcp<Ours<"tool_call">>>().toExtend<Acp<"tool_call">>();
    expectTypeOf<FromAcp<Ours<"tool_call_update">>>().toExtend<Acp<"tool_call_update">>();
    expectTypeOf<FromAcp<Ours<"session_info_update">>>().toExtend<Acp<"session_info_update">>();
    expectTypeOf<FromAcp<Ours<"usage_update">>>().toExtend<Acp<"usage_update">>();
    expectTypeOf<FromAcp<Ours<"available_commands_update">>>().toExtend<Acp<"available_commands_update">>();
    expectTypeOf<FromAcp<Ours<"config_option_update">>>().toExtend<Acp<"config_option_update">>();
    expectTypeOf<FromAcp<SessionUpdate>>().toExtend<AcpSessionUpdate>();
  });
});
