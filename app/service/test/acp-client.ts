// A minimal ACP client for tests: starts an agent through the real spawn path, records what it sends,
// and parses every session update with the shared contract schema.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type InitializeResponse,
  type PermissionOptionKind,
  type PromptResponse,
  type RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import { SessionUpdate } from "@wombat/shared/api";

import { startAgentProcess, type SpawnSpec } from "../src/harness/harness.ts";

/** What the client received, in arrival order. */
export type Received =
  | { type: "update"; update: SessionUpdate }
  | { type: "permission"; request: RequestPermissionRequest };

export type Exit = { code: number | null; signal: NodeJS.Signals | null };

export type AgentUnderTest = {
  agent: ClientConnection["agent"];
  received: Received[];
  /** Session updates the shared `SessionUpdate` schema rejected; a test expects none. */
  parseFailures: { update: unknown; error: string }[];
  closed: Promise<void>;
  exited: Promise<Exit>;
  initialize: () => Promise<InitializeResponse>;
  newSession: (cwd: string) => Promise<string>;
  prompt: (sessionId: string, text: string) => Promise<PromptResponse>;
  /** Kills the agent's process group (and the process itself) and closes the connection. Safe to call twice. */
  kill: () => void;
  stderr: () => string;
};

export type RunOptions = {
  /** The permission option kind the client picks when the agent asks; cancels when it isn't offered. */
  answer?: PermissionOptionKind;
};

const killProcess = (child: ChildProcessWithoutNullStreams) => {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Not a group leader (or already gone): kill the process itself.
    child.kill("SIGKILL");
  }
};

export const runAgent = (spec: SpawnSpec, options: RunOptions = {}): AgentUnderTest => {
  const child = startAgentProcess(spec);
  const exited = new Promise<Exit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  // Writes after the agent died must not crash the test run; the connection reports the close.
  child.stdin.on("error", () => undefined);
  child.on("error", (error) => {
    stderr += `\n[spawn error] ${error.message}`;
  });

  const received: Received[] = [];
  const parseFailures: AgentUnderTest["parseFailures"] = [];

  const app = client({ name: "wombat-test-client" })
    .onNotification("session/update", ({ params }) => {
      const result = SessionUpdate.safeParse(params.update);
      if (result.success) received.push({ type: "update", update: result.data });
      else parseFailures.push({ update: params.update, error: result.error.message });
    })
    .onRequest("session/request_permission", ({ params }) => {
      received.push({ type: "permission", request: params });
      const option = params.options.find((candidate) => candidate.kind === options.answer);
      return option
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } };
    });

  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );

  return {
    agent: connection.agent,
    received,
    parseFailures,
    closed: connection.closed,
    exited,
    initialize: () =>
      connection.agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "wombat-test-client", version: "0.0.0" },
      }),
    newSession: async (cwd) => (await connection.agent.request("session/new", { cwd, mcpServers: [] })).sessionId,
    prompt: (sessionId, text) =>
      connection.agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }),
    kill: () => {
      killProcess(child);
      connection.close();
    },
    stderr: () => stderr,
  };
};

/** The session updates received, in order. */
export const updatesOf = (run: AgentUnderTest) =>
  run.received.flatMap((item) => (item.type === "update" ? [item.update] : []));
