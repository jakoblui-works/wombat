// A scripted ACP v1 agent for tests, run as `node fake-agent.ts <scenario>`. Stdout carries ACP only.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, writeSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import { agent, ndJsonStream, RequestError, type AgentContext, type SessionUpdate } from "@agentclientprotocol/sdk";

const SCENARIOS = [
  "reply",
  "permission",
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
] as const;

export type FakeScenario = (typeof SCENARIOS)[number];

const isScenario = (name: string | undefined): name is FakeScenario =>
  (SCENARIOS as readonly (string | undefined)[]).includes(name);

// Tests look for these markers in the service's logs, which must never contain them.
const NOISY_STDERR_MARKER = "stderr-content-must-not-be-logged";
const SKIPPED_UPDATE_MARKER = "thought-content-must-not-be-logged";

/** The title the early-update scenario sends before its `session/new` answer. */
export const EARLY_TITLE = "Title sent while the session starts";

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

// A 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const text = (value: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: value },
});

const run = (scenario: FakeScenario) => {
  // Prompts held by the hang scenario, by session, until `session/cancel` releases them.
  const held = new Map<string, () => void>();
  // Sessions a `session/cancel` arrived for while a permission request was open.
  const cancelled = new Set<string>();
  // The mcpServers entries the last session/new carried, for the mcp-config scenario.
  let mcpServers: unknown = undefined;

  const send = (client: AgentContext, sessionId: string, update: SessionUpdate) =>
    client.notify("session/update", { sessionId, update });

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
      return { sessionId };
    })
    .onNotification("session/cancel", ({ params }) => {
      cancelled.add(params.sessionId);
      held.get(params.sessionId)?.();
    })
    .onRequest("session/prompt", async ({ params: { sessionId, prompt }, client }) => {
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
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
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
          await send(client, sessionId, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: SKIPPED_UPDATE_MARKER },
          });
          await send(client, sessionId, text("Thinking is over."));
          await send(client, sessionId, text(" Here is the answer."));
          return { stopReason: "end_turn" };
        case "mcp-config": {
          // The prompt is a file path: the agent writes the mcpServers entries it got, and its environment, there
          // rather than into its reply, so the token never enters the service's log through this seam. "crash"
          // instead ends the process as a crash would.
          const [block] = prompt;
          const path = block?.type === "text" ? block.text : "";
          if (path === "crash") process.exit(3);
          writeFileSync(path, JSON.stringify({ mcpServers, env: process.env }));
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
        case "auth":
          break;
      }
      throw RequestError.internalError(undefined, `scenario ${scenario} has no prompt`);
    });

  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
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
