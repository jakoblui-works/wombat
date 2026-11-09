// A scripted ACP v1 agent for tests, run as `node fake-agent.ts <scenario>`. Stdout carries ACP only.
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

import { agent, ndJsonStream, RequestError, type AgentContext, type SessionUpdate } from "@agentclientprotocol/sdk";

const SCENARIOS = ["reply", "permission", "image", "auth", "crash", "hang", "env"] as const;

export type FakeScenario = (typeof SCENARIOS)[number];

const isScenario = (name: string | undefined): name is FakeScenario =>
  (SCENARIOS as readonly (string | undefined)[]).includes(name);

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

  const send = (client: AgentContext, sessionId: string, update: SessionUpdate) =>
    client.notify("session/update", { sessionId, update });

  const app = agent({ name: "wombat-fake-agent" })
    .onRequest("initialize", () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "wombat-fake-agent", version: "0.0.0" },
      authMethods: [],
    }))
    .onRequest("session/new", () => {
      if (scenario === "auth") throw RequestError.authRequired();
      return { sessionId: randomUUID() };
    })
    .onNotification("session/cancel", ({ params }) => {
      cancelled.add(params.sessionId);
      held.get(params.sessionId)?.();
    })
    .onRequest("session/prompt", async ({ params: { sessionId }, client }) => {
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
