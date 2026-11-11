import { expect, test } from "vitest";

import type { ChatItem } from "../../../data/chat-model.ts";
import { chatBlocks } from "./chat-blocks.ts";

const at = "2026-01-01T00:00:00.000Z";
const tool = (id: string, sessionId?: string): ChatItem => ({
  kind: "tool",
  key: `tool:${id}`,
  toolCallId: id,
  title: id,
  toolKind: "read",
  content: [],
  locations: [],
  at,
  ...(sessionId === undefined ? {} : { sessionId }),
});
const agent = (seq: number): ChatItem => ({ kind: "agent", key: `agent:${String(seq)}`, text: "x", at });

test("consecutive tool calls of one session share a list; anything between, or another session, starts a new one", () => {
  const blocks = chatBlocks([tool("a"), tool("b"), agent(3), tool("c"), tool("d", "sub")]);
  expect(blocks.map((block) => (block.kind === "tools" ? block.items.map(({ key }) => key) : block.key))).toEqual([
    ["tool:a", "tool:b"],
    "agent:3",
    ["tool:c"],
    ["tool:d"],
  ]);
});
