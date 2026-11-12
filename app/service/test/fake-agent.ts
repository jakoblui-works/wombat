// A scripted ACP v1 agent for tests, run as `node fake-agent.ts <scenario>`. Stdout carries ACP only.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync, writeSync } from "node:fs";
import { Readable, Transform, Writable } from "node:stream";

import type { ContextBreakdown } from "@wombat/shared/api";

import {
  agent,
  ndJsonStream,
  RequestError,
  type AgentContext,
  type PermissionOption,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

export const SCENARIOS = [
  "reply",
  "permission",
  "permissions-three",
  "permission-left-open",
  "image",
  "auth",
  "crash",
  "hang",
  "env",
  "noisy",
  "spawn-child",
  "unknown-update",
  "detached-holder",
  "early-update",
  "mcp-config",
  "call-tool",
  "message-ids",
  "message-runs",
  "plan-thought",
  "hostile",
  "prompt-error",
  "stop-error",
  "replay",
] as const;

export type FakeScenario = (typeof SCENARIOS)[number];

const isScenario = (name: string | undefined): name is FakeScenario =>
  (SCENARIOS as readonly (string | undefined)[]).includes(name);

type SdkToolCall = Extract<SessionUpdate, { sessionUpdate: "tool_call" }>;

/**
 * One step of the replay scenario, whose prompt is a JSON array of them (one turn): `send` sends a session update,
 * `ask` asks for a permission without waiting for the answer, `awaitAnswers` waits until every request asked so far is
 * answered, `awaitFile` holds the turn (the agent stays working, nothing asked of the user) until a file exists at that
 * path. `cache` sends the cache state as the extension notification FAKE_EXT.cache, which the fake harness reports as the
 * agent's cache state (the `fake-cache` step). `sub` sends in the sub-agent session `<sessionId>` + REPLAY_SUB_SUFFIX instead of the main one. Requests
 * still open when the steps run out stay open; the turn ends with end_turn either way.
 */
export type ReplayStep =
  | { send: SessionUpdate; sub?: boolean }
  | { cache: FakeCacheState | null }
  | { ask: { toolCallId: string; title?: string; kind?: SdkToolCall["kind"] }; sub?: boolean }
  | { awaitAnswers: true }
  | { awaitFile: string };

/** A cache state as the `cache` replay step sends it (the shape of `AgentSummary["cache"]`). */
export type FakeCacheState = { ttlSeconds: number; lastRequestAt: string };

/** The extension notifications the fake agent sends and the fake harness reads (ACP extension methods start `_`). */
export const FAKE_EXT = { context: "_fake/context", cache: "_fake/cache" } as const;

/**
 * The fixed breakdown every scenario reports for a `/context` prompt (sent as FAKE_EXT.context `{ sessionId,
 * breakdown }`): every category kind, and one list. Invented values.
 */
export const FAKE_BREAKDOWN: ContextBreakdown = {
  model: "fake-small",
  used: 61_000,
  size: 200_000,
  categories: [
    { name: "Fake instructions", tokens: 4_000, kind: "used" },
    { name: "Fake conversation", tokens: 42_000, kind: "used" },
    { name: "Fake unloaded tools", tokens: 6_000, kind: "deferred" },
    { name: "Fake reserve", tokens: 15_000, kind: "buffer" },
    { name: "Fake free space", tokens: 133_000, kind: "free" },
  ],
  lists: [{ id: "fake_notes", title: "Fake notes", rows: [{ name: "opening-hours.md", detail: "Project", tokens: 900 }] }],
};

/**
 * What a `/context` prompt sends before its report, in every scenario: a message chunk carrying this marker, a
 * usage_update and a session_info_update with HIDDEN_TITLE. A hidden turn must drop all three, and no log line may
 * carry the marker.
 */
export const HIDDEN_UPDATE_MARKER = "hidden-turn-content-must-not-be-logged";
export const HIDDEN_TITLE = "Title sent during the hidden turn";

/** The prompt-error scenario answers `/context` with its chunk, then fails with this message. */
export const CONTEXT_FAILURE_MESSAGE = "the fake agent fails its context report";

/**
 * The hang scenario holds a `/context` prompt open: it writes CONTEXT_STARTED_FILE in its working directory (the
 * agent's folder) when the prompt arrives, and answers once CONTEXT_RELEASE_FILE exists there.
 */
export const CONTEXT_STARTED_FILE = ".fake-context-started";
export const CONTEXT_RELEASE_FILE = ".fake-context-release";

/**
 * When a `session/cancel` arrives while the hang scenario holds a `/context` prompt, it writes this file in its working
 * directory, then sends the same updates as a report would (late, as a real agent may) and answers `cancelled`.
 */
export const CONTEXT_CANCELLED_FILE = ".fake-context-cancelled";

/** How often an `awaitFile` step looks for its file. */
const AWAIT_FILE_POLL_MS = 10;

/**
 * The config options every scenario offers (ACP v1 `SessionConfigOption`): a select `model` (category model), a
 * boolean `fast` (no category), a select `effort` (category thought_level) and a select `mode` (category mode).
 * A model value starting with `refuse` is offered but refused when set, so a test can see the agent say no to a value
 * the service accepts.
 */
export const FAKE_CONFIG = {
  model: { id: "model", values: ["fake-small", "refuse-large"] as const, initial: "fake-small" },
  fast: { id: "fast", initial: false },
  effort: { id: "effort", values: ["low", "medium", "high"] as const, initial: "medium" },
  mode: { id: "mode", values: ["ask", "plan"] as const, initial: "ask" },
} as const;

/** The agent's JSON-RPC error message when it refuses a set; tests check it never reaches the service's logs. */
export const CONFIG_REFUSAL_MESSAGE = "config-refusal-must-not-be-logged";

export type FakeConfig = { model: string; fast: boolean; effort?: string; mode?: string };

/** The options as the fake sends them for the given values, in the agent's order (model, fast, effort, mode). */
export const fakeConfigOptions = ({
  model,
  fast,
  effort = FAKE_CONFIG.effort.initial,
  mode = FAKE_CONFIG.mode.initial,
}: FakeConfig): SessionConfigOption[] => [
  {
    type: "select",
    id: FAKE_CONFIG.model.id,
    name: "Model",
    description: "Which model the fake agent pretends to run",
    category: "model",
    currentValue: model,
    options: [
      { value: "fake-small", name: "Fake small" },
      { value: "refuse-large", name: "Refuse large", description: "Offered, but the agent refuses it" },
    ],
  },
  { type: "boolean", id: FAKE_CONFIG.fast.id, name: "Fast mode", currentValue: fast },
  {
    type: "select",
    id: FAKE_CONFIG.effort.id,
    name: "Effort",
    description: "How hard the fake agent pretends to think",
    category: "thought_level",
    currentValue: effort,
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    type: "select",
    id: FAKE_CONFIG.mode.id,
    name: "Mode",
    category: "mode",
    currentValue: mode,
    options: [
      { value: "ask", name: "Ask first", description: "Asks before every edit" },
      { value: "plan", name: "Plan only" },
    ],
  },
];

/** Appended to the main session's id to make the replay scenario's sub-agent session. */
export const REPLAY_SUB_SUFFIX = ":sub";

// Tests look for these markers in the service's logs, which must never contain them.
const NOISY_STDERR_MARKER = "stderr-content-must-not-be-logged";
const SKIPPED_UPDATE_MARKER = "thought-content-must-not-be-logged";

/** The title the early-update scenario sends before its `session/new` answer. */
export const EARLY_TITLE = "Title sent while the session starts";

/**
 * What the hostile scenario sends: agent content that would run in the page, navigate it or load something if the
 * app rendered it as anything but text. Every payload that could run sets `window[HOSTILE.marker]` (to where it
 * came from), so a check can tell whether any ran; the CSP should stop them anyway, but the app must never try.
 */
export const HOSTILE = {
  marker: "__wombatHostile",
  /** Markdown with raw HTML, scripts, non-https links of every syntax, an image and a fenced HTML block. */
  markdown: (where: string): string =>
    [
      `Hostile ${where} starts.`,
      `<script>window.__wombatHostile = "${where}: script"</script>`,
      `<img src="x" onerror="window.__wombatHostile = '${where}: img onerror'">`,
      `<iframe src="https://example.invalid/frame"></iframe>`,
      `<a href="javascript:window.__wombatHostile='${where}: html link'">html link ${where}</a>`,
      `[javascript link ${where}](javascript:window.__wombatHostile='${where}:%20javascript%20link')`,
      `[data link ${where}](data:text/html,<script>window.__wombatHostile=1</script>)`,
      `[file link ${where}](file:///etc/hostname)`,
      `[relative link ${where}](../../index.html)`,
      `[app link ${where}](app://wombat/index.html)`,
      `[reference link ${where}][evil]`,
      `<javascript:window.__wombatHostile='${where}: autolink'>`,
      `www.example.invalid and http://example.invalid/plain`,
      `![image alt ${where}](https://example.invalid/pixel.png)`,
      `[safe link ${where}](https://example.invalid/docs)`,
      "",
      "```html",
      `<script>window.__wombatHostile = "${where}: code block"</script>`,
      "```",
      "",
      `[evil]: javascript:window.__wombatHostile='${where}:%20reference'`,
    ].join("\n\n"),
  /** Raw HTML as plain text fields carry it (a title, a plan entry, a tool's input and output). */
  html: (where: string): string => `<img src="x" onerror="window.__wombatHostile = '${where}'"><b>${where}</b><script>window.__wombatHostile = "${where}"</script>`,
  /** The huge tool output's length: far beyond what the chat shows of one text. */
  hugeChars: 400_000,
  /** The huge output's text: one recognisable line repeated (no markup). */
  hugeText: (chars: number): string => "huge output line 0123456789\n".repeat(Math.ceil(chars / 28)).slice(0, chars),
  /** The permission request's title (its tool call's). */
  permissionTitle: (): string => HOSTILE.html("permission title"),
  /** The edit's file name: hostile markup without a "/" (the last path segment is what shows, as the diff tab's title). */
  editFileName: (): string => `<img src=x onerror="window.__wombatHostile='diff title'"><i>diff title<i>.md`,
  /** The edit request: its title, path and both texts carry the payloads (the inline card, the diff tab and its title). */
  edit: (): { title: string; path: string; oldText: string; newText: string } => ({
    title: HOSTILE.html("edit title"),
    path: `/tmp/hostile/${HOSTILE.editFileName()}`,
    oldText: `Opening hours\n${HOSTILE.html("diff old")}\nClosed on Sundays\n`,
    newText: `Opening hours\n${HOSTILE.html("diff new")}\nClosed on Sundays\n`,
  }),
} as const;

// Well past a pipe buffer (~64 KiB), so an agent whose stderr isn't read blocks.
const NOISY_STDERR_BYTES = 1024 * 1024;

/**
 * Writes all of `data` to `fd` before returning, as a blocking write would: Node's `process.stderr.write` queues
 * in memory instead, and the fd is non-blocking, so a full pipe answers EAGAIN until the reader drains it.
 */
const writeAllSync = (fd: number, data: Buffer) => {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let offset = 0;
  while (offset < data.length) {
    try {
      offset += writeSync(fd, data, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
};

// The options every permission request offers; the scenarios and their tests answer by these ids.
const ALLOW_REJECT: PermissionOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

// A 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const text = (value: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: value },
});

const messageText = (value: string, messageId: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  messageId,
  content: { type: "text", text: value },
});

const run = (scenario: FakeScenario) => {
  // Prompts held by the hang scenario, by session, until `session/cancel` releases them.
  const held = new Map<string, () => void>();
  // Sessions a `session/cancel` arrived for while a permission request was open.
  const cancelled = new Set<string>();
  // The mcpServers entries the last session/new carried, for the mcp-config scenario.
  let mcpServers: unknown = undefined;
  // The last session/new's params as they came over the wire, before the SDK's schema drops fields it doesn't
  // know (the stable v1 schema has no `systemPrompt`), for the mcp-config scenario.
  let sessionNew: unknown = undefined;
  // The last session/set_config_option's params as they came over the wire (the SDK's union may read a shape the
  // real agent would refuse), and each session's current config values.
  let lastSet: Record<string, unknown> | undefined = undefined;
  const configs = new Map<string, FakeConfig>();
  let pending = "";
  const recorder = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as { method?: unknown; params?: unknown };
          if (message.method === "session/new") sessionNew = message.params;
          if (message.method === "session/set_config_option") lastSet = message.params as Record<string, unknown>;
        } catch {
          // Not JSON: the SDK reports it.
        }
      }
      done(null, chunk);
    },
  });

  const send = (client: AgentContext, sessionId: string, update: SessionUpdate) =>
    client.notify("session/update", { sessionId, update });

  // A `/context` prompt, in every scenario: updates a hidden turn must drop, then the report (see FAKE_BREAKDOWN).
  const answerContext = async (client: AgentContext, sessionId: string) => {
    if (scenario === "hang") {
      cancelled.delete(sessionId);
      writeFileSync(CONTEXT_STARTED_FILE, "");
      while (!existsSync(CONTEXT_RELEASE_FILE) && !cancelled.has(sessionId)) {
        await new Promise((resolve) => setTimeout(resolve, AWAIT_FILE_POLL_MS));
      }
      if (cancelled.delete(sessionId)) {
        writeFileSync(CONTEXT_CANCELLED_FILE, "");
        await send(client, sessionId, text(`${HIDDEN_UPDATE_MARKER}: late output after the cancel`));
        await send(client, sessionId, { sessionUpdate: "usage_update", used: FAKE_BREAKDOWN.used, size: FAKE_BREAKDOWN.size });
        await send(client, sessionId, { sessionUpdate: "session_info_update", title: HIDDEN_TITLE });
        return { stopReason: "cancelled" as const };
      }
    }
    await send(client, sessionId, text(`${HIDDEN_UPDATE_MARKER}: the context report as markdown`));
    if (scenario === "prompt-error") throw RequestError.internalError(undefined, CONTEXT_FAILURE_MESSAGE);
    await send(client, sessionId, { sessionUpdate: "usage_update", used: FAKE_BREAKDOWN.used, size: FAKE_BREAKDOWN.size });
    await send(client, sessionId, { sessionUpdate: "session_info_update", title: HIDDEN_TITLE });
    await client.notify(FAKE_EXT.context, { sessionId, breakdown: FAKE_BREAKDOWN });
    return { stopReason: "end_turn" as const };
  };

  const app = agent({ name: "wombat-fake-agent" })
    .onRequest("initialize", () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "wombat-fake-agent", version: "0.0.0" },
      authMethods: [],
    }))
    .onRequest("session/new", async ({ params, client }) => {
      if (scenario === "auth") throw RequestError.authRequired();
      mcpServers = params.mcpServers;
      const sessionId = randomUUID();
      // claude-agent-acp's command list can be handled by the service before its session/new answer is; sending
      // the updates first makes that order certain, so the service's hold-and-replay of early updates is exercised.
      if (scenario === "early-update") {
        await send(client, sessionId, { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review the diff" }] });
        await send(client, sessionId, { sessionUpdate: "session_info_update", title: EARLY_TITLE });
      }
      configs.set(sessionId, { model: FAKE_CONFIG.model.initial, fast: FAKE_CONFIG.fast.initial });
      return { sessionId, configOptions: fakeConfigOptions({ model: FAKE_CONFIG.model.initial, fast: FAKE_CONFIG.fast.initial }) };
    })
    .onRequest("session/set_config_option", ({ params }) => {
      const config = configs.get(params.sessionId);
      if (config === undefined) throw RequestError.invalidParams(undefined, "unknown session");
      const raw = lastSet ?? {};
      if (params.configId === FAKE_CONFIG.model.id) {
        // ACP v1: a select's value is sent bare, without a type.
        if ("type" in raw || typeof raw.value !== "string") throw RequestError.invalidParams(undefined, "model takes a bare string value");
        if (!(FAKE_CONFIG.model.values as readonly string[]).includes(raw.value)) throw RequestError.invalidParams(undefined, "unknown model");
        if (raw.value.startsWith("refuse")) throw RequestError.internalError(undefined, CONFIG_REFUSAL_MESSAGE);
        config.model = raw.value;
      } else if (params.configId === FAKE_CONFIG.effort.id || params.configId === FAKE_CONFIG.mode.id) {
        const option = params.configId === FAKE_CONFIG.effort.id ? FAKE_CONFIG.effort : FAKE_CONFIG.mode;
        if ("type" in raw || typeof raw.value !== "string") throw RequestError.invalidParams(undefined, `${option.id} takes a bare string value`);
        if (!(option.values as readonly string[]).includes(raw.value)) throw RequestError.invalidParams(undefined, `unknown ${option.id}`);
        if (option === FAKE_CONFIG.effort) config.effort = raw.value;
        else config.mode = raw.value;
      } else if (params.configId === FAKE_CONFIG.fast.id) {
        // ACP v1: a boolean is sent as { type: "boolean", value }.
        if (raw.type !== "boolean" || typeof raw.value !== "boolean") throw RequestError.invalidParams(undefined, "fast takes { type: \"boolean\", value }");
        config.fast = raw.value;
      } else {
        throw RequestError.invalidParams(undefined, "unknown config option");
      }
      return { configOptions: fakeConfigOptions(config) };
    })
    .onNotification("session/cancel", ({ params }) => {
      cancelled.add(params.sessionId);
      held.get(params.sessionId)?.();
    })
    .onRequest("session/prompt", async ({ params: { sessionId, prompt }, client }) => {
      const [only] = prompt;
      if (prompt.length === 1 && only?.type === "text" && only.text === "/context") return answerContext(client, sessionId);
      switch (scenario) {
        case "reply":
          await send(client, sessionId, text("Hello"));
          await send(client, sessionId, text(" from the fake agent."));
          return { stopReason: "end_turn" };
        case "permission": {
          const toolCallId = randomUUID();
          await send(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId,
            title: "Edit notes.txt",
            kind: "edit",
            status: "pending",
            content: [{ type: "diff", path: "/tmp/notes.txt", oldText: "old line\n", newText: "new line\n" }],
          });
          cancelled.delete(sessionId);
          const { outcome } = await client.request("session/request_permission", {
            sessionId,
            toolCall: { toolCallId },
            options: ALLOW_REJECT,
          });
          // ACP v1: a turn cancelled while the request was open ends as cancelled, whatever the client answered.
          const turnCancelled = outcome.outcome === "cancelled" || cancelled.has(sessionId);
          cancelled.delete(sessionId);
          const allowed = !turnCancelled && outcome.outcome === "selected" && outcome.optionId === "allow";
          await send(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: allowed ? "completed" : "failed",
          });
          return { stopReason: turnCancelled ? "cancelled" : "end_turn" };
        }
        case "permissions-three": {
          // Three requests open at once, asked in this order, each naming its tool call differently: the first only
          // by id (its title and kind are in the earlier tool_call), the second in the request itself (over an
          // earlier tool_call that says otherwise), the third by an id nothing else mentions.
          const [stored, named, bare] = [randomUUID(), randomUUID(), randomUUID()];
          await send(client, sessionId, { sessionUpdate: "tool_call", toolCallId: stored, title: "Edit notes.txt", kind: "edit", status: "pending" });
          await send(client, sessionId, { sessionUpdate: "tool_call", toolCallId: named, title: "Run tests", kind: "other", status: "pending" });
          cancelled.delete(sessionId);
          // Sent before any is answered, so all three are open at once.
          const asked = [
            client.request("session/request_permission", {
              sessionId,
              toolCall: { toolCallId: stored },
              options: ALLOW_REJECT,
            }),
            client.request("session/request_permission", {
              sessionId,
              toolCall: { toolCallId: named, title: "Run the test suite", kind: "execute" },
              options: ALLOW_REJECT,
            }),
            client.request("session/request_permission", {
              sessionId,
              toolCall: { toolCallId: bare },
              options: ALLOW_REJECT,
            }),
          ];
          const outcomes = await Promise.all(asked);
          const turnCancelled = cancelled.has(sessionId) || outcomes.some(({ outcome }) => outcome.outcome === "cancelled");
          cancelled.delete(sessionId);
          return { stopReason: turnCancelled ? "cancelled" : "end_turn" };
        }
        case "permission-left-open": {
          // Asks for a permission and ends its turn normally without waiting for the answer: the request is still
          // open when the prompt's answer (end_turn) arrives. Sent in that order on the one stream; that the service
          // then sees the request before the turn's end is the SDK's current receive order, not a guarantee, and
          // pending-permissions.test.ts's seq control checks it. The answer (the service's cancel) is ignored.
          const toolCallId = randomUUID();
          await send(client, sessionId, { sessionUpdate: "tool_call", toolCallId, title: "Edit notes.txt", kind: "edit", status: "pending" });
          void client
            .request("session/request_permission", {
              sessionId,
              toolCall: { toolCallId },
              options: ALLOW_REJECT,
            })
            .catch(() => undefined);
          return { stopReason: "end_turn" };
        }
        case "image":
          await send(client, sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "image", mimeType: "image/png", data: PNG_BASE64 },
          });
          return { stopReason: "end_turn" };
        case "crash":
          await send(client, sessionId, text("About to crash."));
          process.exit(1);
          break;
        case "hang":
          await new Promise<void>((release) => held.set(sessionId, release));
          held.delete(sessionId);
          return { stopReason: "cancelled" };
        case "env":
          await send(client, sessionId, text(JSON.stringify(Object.keys(process.env).sort())));
          return { stopReason: "end_turn" };
        case "noisy": {
          const line = `${NOISY_STDERR_MARKER} ${"x".repeat(64)}\n`;
          writeAllSync(2, Buffer.from(line.repeat(Math.ceil(NOISY_STDERR_BYTES / line.length))));
          await send(client, sessionId, text("Finished after a lot of logging."));
          return { stopReason: "end_turn" };
        }
        case "spawn-child": {
          // Not detached: the child stays in the agent's process group, as an agent's helpers would.
          const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
          await send(client, sessionId, text(JSON.stringify({ childPid: child.pid })));
          return { stopReason: "end_turn" };
        }
        case "detached-holder": {
          // In a process group of its own, holding the agent's stderr open after the agent is gone.
          const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
            detached: true,
            stdio: ["ignore", "ignore", "inherit"],
          });
          await send(client, sessionId, text(JSON.stringify({ childPid: child.pid })));
          return { stopReason: "end_turn" };
        }
        case "unknown-update":
          // A kind ACP has but the shared contract doesn't: the SDK drops kinds unknown to ACP itself before the
          // service sees them, so this is the nearest a test gets to a newer agent's update.
          await send(client, sessionId, {
            sessionUpdate: "compaction_summary_chunk",
            compactionId: "compaction-1",
            content: { type: "text", text: SKIPPED_UPDATE_MARKER },
          });
          await send(client, sessionId, text("Thinking is over."));
          await send(client, sessionId, text(" Here is the answer."));
          return { stopReason: "end_turn" };
        case "mcp-config": {
          // The prompt is a file path: the agent writes the mcpServers entries it got, its environment and the raw
          // session/new params (for the instructions drift check) there rather than into its reply, so the token
          // never enters the service's log through this seam. "crash" instead ends the process as a crash would.
          const [block] = prompt;
          const path = block?.type === "text" ? block.text : "";
          if (path === "crash") process.exit(3);
          writeFileSync(path, JSON.stringify({ mcpServers, env: process.env, sessionNew }));
          await send(client, sessionId, text("Reported the MCP config."));
          return { stopReason: "end_turn" };
        }
        case "call-tool": {
          // The prompt is JSON `{ tool, arguments }`: the agent calls that tool on its wombat MCP server, at the URL
          // and with the headers its session/new carried, as a real harness would, and replies with the result's text.
          const [block] = prompt;
          const { tool, arguments: args } = JSON.parse(block?.type === "text" ? block.text : "{}") as {
            tool: string;
            arguments: Record<string, unknown>;
          };
          const servers = (mcpServers ?? []) as { name: string; url: string; headers: { name: string; value: string }[] }[];
          const wombat = servers.find((server) => server.name === "wombat");
          if (!wombat) {
            await send(client, sessionId, text("No wombat MCP server was given."));
            return { stopReason: "end_turn" };
          }
          const response = await fetch(wombat.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...Object.fromEntries(wombat.headers.map((header) => [header.name, header.value])),
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
          });
          const answer = (await response.json()) as { result?: { content?: { type: string; text?: string }[] } };
          const reply = answer.result?.content?.find((content) => content.type === "text")?.text ?? JSON.stringify(answer);
          await send(client, sessionId, text(reply));
          return { stopReason: "end_turn" };
        }
        case "message-ids":
          // Two messages told apart by messageId only, each in two chunks.
          await send(client, sessionId, messageText("The first message,", "msg-1"));
          await send(client, sessionId, messageText(" in two chunks.", "msg-1"));
          await send(client, sessionId, messageText("  The second   message\n\nreplaces", "msg-2"));
          await send(client, sessionId, messageText(" the first. ", "msg-2"));
          return { stopReason: "end_turn" };
        case "message-runs":
          // Chunks without a messageId, split into two runs by a tool call.
          await send(client, sessionId, text("Before the tool call."));
          await send(client, sessionId, { sessionUpdate: "tool_call", toolCallId: randomUUID(), title: "Read notes.txt", kind: "read", status: "completed" });
          await send(client, sessionId, text("After the"));
          await send(client, sessionId, text(" tool call."));
          return { stopReason: "end_turn" };
        case "plan-thought":
          await send(client, sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Weighing where the footer link lives." } });
          await send(client, sessionId, {
            sessionUpdate: "plan",
            entries: [
              { content: "Find the footer component", priority: "high", status: "completed" },
              { content: "Rename the footer link", priority: "medium", status: "in_progress" },
            ],
          });
          await send(client, sessionId, text("Planned the footer change."));
          return { stopReason: "end_turn" };
        case "hostile": {
          // Hostile content in every place agent content shows, then a permission request that stays open.
          await send(client, sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: HOSTILE.markdown("reasoning") } });
          await send(client, sessionId, {
            sessionUpdate: "plan",
            entries: [{ content: HOSTILE.html("plan entry"), priority: "high", status: "in_progress" }],
          });
          await send(client, sessionId, text(HOSTILE.markdown("message")));
          await send(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: randomUUID(),
            title: HOSTILE.html("tool title"),
            kind: "execute",
            status: "completed",
            rawInput: { command: HOSTILE.html("tool input") },
            rawOutput: HOSTILE.html("tool output"),
            content: [{ type: "content", content: { type: "text", text: HOSTILE.markdown("tool content") } }],
          });
          await send(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: randomUUID(),
            title: "Read the huge log",
            kind: "read",
            status: "completed",
            rawOutput: HOSTILE.hugeText(HOSTILE.hugeChars),
          });
          // Two requests open at once: a command, and an edit whose path and texts are hostile.
          const toolCallId = randomUUID();
          await send(client, sessionId, { sessionUpdate: "tool_call", toolCallId, title: HOSTILE.permissionTitle(), kind: "execute", status: "pending" });
          const edit = HOSTILE.edit();
          const editId = randomUUID();
          await send(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: editId,
            title: edit.title,
            kind: "edit",
            status: "pending",
            locations: [{ path: edit.path }],
            content: [{ type: "diff", path: edit.path, oldText: edit.oldText, newText: edit.newText }],
          });
          cancelled.delete(sessionId);
          const asked = [
            client.request<RequestPermissionResponse>("session/request_permission", { sessionId, toolCall: { toolCallId }, options: ALLOW_REJECT }),
            client.request<RequestPermissionResponse>("session/request_permission", { sessionId, toolCall: { toolCallId: editId }, options: ALLOW_REJECT }),
          ];
          const outcomes = await Promise.all(asked);
          const turnCancelled = cancelled.has(sessionId) || outcomes.some(({ outcome }) => outcome.outcome === "cancelled");
          cancelled.delete(sessionId);
          return { stopReason: turnCancelled ? "cancelled" : "end_turn" };
        }
        case "prompt-error":
          // A turn the agent fails while its process and the connection stay up: the prompt answers with an
          // ACP error, every time.
          await send(client, sessionId, text("Looking into it."));
          throw RequestError.internalError(undefined, "the fake agent fails every turn");
        case "stop-error": {
          // An agent that answers its open prompt with an error when told to end (SIGTERM) and lingers: the
          // answer reaches the service while it is still ending the process. The handler is set before
          // the message, so a stop sent once the message arrives always meets it.
          const told = new Promise<void>((release) => process.once("SIGTERM", () => release()));
          await send(client, sessionId, text("Working on it."));
          await told;
          throw RequestError.internalError(undefined, "the fake agent was told to end mid-turn");
        }
        case "replay": {
          const [block] = prompt;
          const steps = JSON.parse(block?.type === "text" ? block.text : "[]") as ReplayStep[];
          let open: Promise<unknown>[] = [];
          for (const step of steps) {
            if ("awaitAnswers" in step) {
              await Promise.all(open);
              open = [];
              continue;
            }
            if ("awaitFile" in step) {
              while (!existsSync(step.awaitFile)) await new Promise((resolve) => setTimeout(resolve, AWAIT_FILE_POLL_MS));
              continue;
            }
            if ("cache" in step) {
              await client.notify(FAKE_EXT.cache, { sessionId, cache: step.cache });
              continue;
            }
            const session = step.sub === true ? `${sessionId}${REPLAY_SUB_SUFFIX}` : sessionId;
            if ("send" in step) {
              await send(client, session, step.send);
            } else {
              open.push(
                client
                  .request("session/request_permission", {
                    sessionId: session,
                    toolCall: step.ask,
                    options: ALLOW_REJECT,
                  })
                  .catch(() => undefined),
              );
            }
          }
          return { stopReason: "end_turn" };
        }
        case "auth":
          break;
      }
      throw RequestError.internalError(undefined, `scenario ${scenario} has no prompt`);
    });

  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin.pipe(recorder)) as ReadableStream<Uint8Array>,
    ),
  );
  void connection.closed.then(() => process.exit(0));
};

if (import.meta.main) {
  const [scenario] = process.argv.slice(2);
  if (!isScenario(scenario)) {
    process.stderr.write(`fake-agent: unknown scenario ${String(scenario)}; expected one of ${SCENARIOS.join(", ")}\n`);
    process.exit(2);
  }
  run(scenario);
}
