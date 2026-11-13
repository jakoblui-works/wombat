import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type McpServer,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

/** What the agent asks of the client; the handlers must not throw. */
export type AgentHandlers = {
  /** A `session/update`'s update, unparsed: the caller checks it against the shared contract. */
  update: (sessionId: string, update: unknown) => void;
  /** Every other notification (ACP extension notifications, `_`-prefixed), with its method and params unparsed. */
  ext: (method: string, params: unknown) => void;
  permission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
};

/** What a session starts (or resumes) with besides its folder: the MCP servers it may call, and harness-only options. */
export type SessionExtra = {
  mcpServers?: McpServer[];
  _meta?: Record<string, unknown>;
  /**
   * Top-level `session/new` (and `session/resume`) fields a harness asks for (the instructions' `systemPrompt`). Sent as given: the SDK
   * doesn't check outgoing params, and its stable schema would drop fields it doesn't know.
   */
  params?: Record<string, unknown>;
};

/** The client side of ACP for one agent process, over its stdio. */
export type AcpAgent = {
  initialize: () => Promise<InitializeResponse>;
  /** The session's id, and its config options unparsed (`[]` when the agent sends none). */
  newSession: (cwd: string, extra?: SessionExtra) => Promise<{ sessionId: string; configOptions: unknown[] }>;
  /**
   * Takes up a stored session in this process (ACP `session/resume`: the agent keeps its memory of the conversation and
   * replays nothing), with the same extras as `newSession`. Its config options unparsed (`[]` when the agent sends none).
   */
  resumeSession: (sessionId: string, cwd: string, extra?: SessionExtra) => Promise<{ configOptions: unknown[] }>;
  prompt: (sessionId: string, text: string) => Promise<PromptResponse>;
  cancel: (sessionId: string) => Promise<void>;
  /**
   * Sets one config option (ACP v1: a boolean goes as `{ type: "boolean", value }`, a select's value id bare). Resolves
   * to the agent's whole new list of options, unparsed; rejects with the agent's JSON-RPC error when it refuses.
   */
  setConfigOption: (sessionId: string, configId: string, value: string | boolean) => Promise<unknown[]>;
  /** True once the connection closed (the agent's stdout ended, or `close` was called). */
  isClosed: () => boolean;
  close: () => void;
};

/**
 * Connects to an agent process. Its stderr is read and dropped: an unread pipe blocks a talkative agent, and
 * what an agent writes there may hold content that must never reach the service's logs.
 */
export const connectAgent = (child: ChildProcessWithoutNullStreams, handlers: AgentHandlers): AcpAgent => {
  child.stderr.resume();
  // Writes after the agent died fail with EPIPE; the connection reports the close.
  child.stdin.on("error", () => undefined);

  const app = client({ name: "wombat-service" })
    .onNotification("session/update", ({ params }) => {
      handlers.update(params.sessionId, params.update);
    })
    // The SDK's fallback, after normal dispatch: every notification no handler above took.
    .onNotification("*", ({ method, params }) => {
      handlers.ext(method, params);
    })
    // No fs or terminal capabilities are advertised, so permission requests are the only requests expected.
    .onRequest("session/request_permission", ({ params }) => handlers.permission(params));

  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );
  const { agent } = connection;

  return {
    initialize: () =>
      agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "wombat-service", version: "0.0.0" },
      }),
    newSession: async (cwd, { mcpServers = [], _meta, params = {} } = {}) => {
      const { sessionId, configOptions } = await agent.request("session/new", { ...params, cwd, mcpServers, ...(_meta === undefined ? {} : { _meta }) });
      return { sessionId, configOptions: configOptions ?? [] };
    },
    resumeSession: async (sessionId, cwd, { mcpServers = [], _meta, params = {} } = {}) => {
      const { configOptions } = await agent.request("session/resume", { ...params, sessionId, cwd, mcpServers, ...(_meta === undefined ? {} : { _meta }) });
      return { configOptions: configOptions ?? [] };
    },
    prompt: (sessionId, text) => agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }),
    cancel: (sessionId) => agent.notify("session/cancel", { sessionId }),
    setConfigOption: async (sessionId, configId, value) =>
      (
        await agent.request(
          "session/set_config_option",
          typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value },
        )
      ).configOptions,
    isClosed: () => connection.signal.aborted,
    close: () => connection.close(),
  };
};
