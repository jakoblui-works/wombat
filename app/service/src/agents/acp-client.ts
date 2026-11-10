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

/** What the agent asks of the client; both handlers must not throw. */
export type AgentHandlers = {
  /** A `session/update`'s update, unparsed: the caller checks it against the shared contract. */
  update: (sessionId: string, update: unknown) => void;
  permission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
};

/** What a session starts with besides its folder: the MCP servers it may call, and harness-only options. */
export type SessionExtra = {
  mcpServers?: McpServer[];
  _meta?: Record<string, unknown>;
};

/** The client side of ACP for one agent process, over its stdio. */
export type AcpAgent = {
  initialize: () => Promise<InitializeResponse>;
  newSession: (cwd: string, extra?: SessionExtra) => Promise<string>;
  prompt: (sessionId: string, text: string) => Promise<PromptResponse>;
  cancel: (sessionId: string) => Promise<void>;
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
    newSession: async (cwd, { mcpServers = [], _meta } = {}) =>
      (await agent.request("session/new", { cwd, mcpServers, ...(_meta === undefined ? {} : { _meta }) })).sessionId,
    prompt: (sessionId, text) => agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }),
    cancel: (sessionId) => agent.notify("session/cancel", { sessionId }),
    isClosed: () => connection.signal.aborted,
    close: () => connection.close(),
  };
};
