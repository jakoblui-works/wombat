// Turns an agent's log into what the chat shows. Pure, and the same however the log arrived: entries are taken in
// seq order, once each (chat-model.append-order.test.ts). How entries become items is the shared log fold's.
import { foldLog, permissionOf, UNKNOWN_PERMISSION, type ChatItem, type PlanEntry } from "@wombat/shared/log-fold";
import { bySeq } from "./by-seq.ts";
import type { AgentLogEntry } from "./query-client.ts";

export type { ChatItem, PlanEntry, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from "@wombat/shared/log-fold";

export type ChatModel = { items: ChatItem[]; plan?: PlanEntry[]; turnActive: boolean };

export type ChatModelOptions = {
  /** The agent's own session (`AgentSummary.sessionId`); without it, the session of the first entry that has one. */
  mainSessionId?: string;
};

export const chatModel = (entries: readonly AgentLogEntry[], { mainSessionId }: ChatModelOptions = {}): ChatModel => {
  const state = foldLog(bySeq(entries), mainSessionId);

  for (const [requestId, { item, cancelled }] of state.permissions) {
    item.title = (permissionOf(state, requestId) ?? UNKNOWN_PERMISSION).title;
    const answer = state.answers.get(requestId) ?? (cancelled ? "cancelled" : undefined);
    if (answer !== undefined) item.answer = answer;
  }

  return { items: state.items, ...(state.plan === undefined ? {} : { plan: state.plan }), turnActive: state.turnActive };
};
