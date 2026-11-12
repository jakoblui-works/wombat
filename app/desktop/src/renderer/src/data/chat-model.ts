// Turns an agent's log into what the chat shows. Pure, and the same however the log arrived: entries are taken in
// seq order, once each (chat-model.append-order.test.ts). How entries become items is the shared log fold's.
import { emptyFold, foldEntry, permissionOf, type ChatItem, type PlanEntry } from "@wombat/shared/log-fold";
import { bySeq } from "./by-seq.ts";
import type { AgentLogEntry } from "./query-client.ts";

export type { ChatItem, PlanEntry, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from "@wombat/shared/log-fold";

export type ChatModel = { items: ChatItem[]; plan?: PlanEntry[]; turnActive: boolean };

export type ChatModelOptions = {
  /** The agent's own session (`AgentSummary.sessionId`); without it, the session of the first entry that has one. */
  mainSessionId?: string;
};

/** The chat keeps every chunk's text. */
const keepAll = (kept: string, chunk: string): string => kept + chunk;

export const chatModel = (entries: readonly AgentLogEntry[], { mainSessionId }: ChatModelOptions = {}): ChatModel => {
  const state = emptyFold(mainSessionId);
  for (const entry of bySeq(entries)) foldEntry(state, entry, { keepText: keepAll });

  for (const [requestId, { item, cancelled }] of state.permissions) {
    item.title = permissionOf(state, requestId)?.title ?? "";
    const answer = state.answers.get(requestId) ?? (cancelled ? "cancelled" : undefined);
    if (answer !== undefined) item.answer = answer;
  }

  return { items: state.items, ...(state.plan === undefined ? {} : { plan: state.plan }), turnActive: state.turnActive };
};
