// The Claude harness's prompt-cache state, read from the raw
// SDK messages claude-agent-acp forwards as `_claude/sdkMessage` once session/new asks for them. Invented messages in
// the shape of `SDKAssistantMessage` (@anthropic-ai/claude-agent-sdk); timestamps far in the past, so a state stamped
// with the service's clock can't pass for one stamped with the message's.
import { expect, test } from "vitest";

import { cacheStateOf, claudeCode } from "./claude-code.ts";

const AT = "2025-06-01T08:00:00.000Z";
const EARLIER = "2025-06-01T07:40:00.000Z";

type Usage = { h1?: number; m5?: number; read?: number };

/** A raw assistant message as claude-agent-acp forwards it; `parent` set makes it a sub-agent's. */
const assistant = ({ h1 = 0, m5 = 0, read = 0 }: Usage, { at = AT, parent = null as string | null } = {}) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  timestamp: at,
  uuid: "6f1c2a3b-0000-4000-8000-000000000001",
  session_id: "session-bakery-1",
  message: {
    id: "msg_bakery_1",
    type: "message",
    role: "assistant",
    model: "claude-sample-model",
    content: [{ type: "text", text: "Updated the opening hours." }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 12,
      output_tokens: 40,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: h1 + m5,
      cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: m5 },
    },
  },
});

const HOUR = 3600;
const FIVE_MINUTES = 300;
const previousHour = { ttlSeconds: HOUR, lastRequestAt: EARLIER };

test.each([
  { what: "a 1h write starts a 1h cache", usage: { h1: 900 }, previous: null, ttl: HOUR },
  { what: "a 5m write after a 1h cache is 5m", usage: { m5: 900 }, previous: previousHour, ttl: FIVE_MINUTES },
  { what: "a read refreshes a 1h cache at 1h", usage: { read: 5000 }, previous: previousHour, ttl: HOUR },
])("$what, timed by the message's timestamp", ({ usage, previous, ttl }) => {
  expect(cacheStateOf(assistant(usage), previous)).toEqual({ ttlSeconds: ttl, lastRequestAt: AT });
});

test.each([
  { what: "a read with no cache known is no state", usage: { read: 5000 }, previous: null, expected: null },
  { what: "neither a write nor a read (the /context reply) leaves a 1h cache as it was", usage: {}, previous: previousHour, expected: previousHour },
])("$what", ({ usage, previous, expected }) => {
  expect(cacheStateOf(assistant(usage), previous)).toEqual(expected);
});

test("only a main-thread assistant message on _claude/sdkMessage yields a cache state", () => {
  const { extNotification } = claudeCode;
  expect(extNotification, "the Claude harness reads extension notifications").toBeTypeOf("function");
  const sdkMessage = (message: unknown) => extNotification?.("_claude/sdkMessage", { sessionId: "session-bakery-1", message });

  // Control: the main thread's 1h write (the TTL doesn't depend on an earlier state).
  expect(sdkMessage(assistant({ h1: 900 }))?.cache).toEqual({ ttlSeconds: HOUR, lastRequestAt: AT });

  const none: [string, { cache?: unknown } | undefined][] = [
    ["a sub-agent's message", sdkMessage(assistant({ m5: 900 }, { parent: "toolu_bakery_7" }))],
  ];
  for (const [what, result] of none) expect(result?.cache, what).toBeUndefined();
});
