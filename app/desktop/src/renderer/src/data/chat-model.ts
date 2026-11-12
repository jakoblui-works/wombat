// Turns an agent's log into what the chat shows. Pure, and the same however the log arrived: entries are taken in
// seq order, once each (chat-model.append-order.test.ts). How entries become items is the shared log fold's.
import type { Activity, ConfigOption } from "@wombat/shared/api";
import {
  activityOf,
  configOf,
  foldLog,
  permissionOf,
  UNKNOWN_PERMISSION,
  usageOf,
  type ChatItem,
  type PlanEntry,
  type Usage,
} from "@wombat/shared/log-fold";
import { bySeq } from "./by-seq.ts";
import type { AgentLogEntry } from "./query-client.ts";

export type { ChatItem, PlanEntry, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind, Usage } from "@wombat/shared/log-fold";

export type ChatModel = {
  items: ChatItem[];
  plan?: PlanEntry[];
  turnActive: boolean;
  /** What the agent is doing this turn (`activityOf`); null outside a turn. */
  activity: Activity | null;
  /** The agent's settings now (`configOf`). */
  config?: ConfigOption[];
  /** The agent's context use now (`usageOf`). */
  usage?: Usage;
};

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

  const config = configOf(state);
  const usage = usageOf(state);
  return {
    items: state.items,
    ...(state.plan === undefined ? {} : { plan: state.plan }),
    turnActive: state.turnActive,
    activity: activityOf(state),
    ...(config === undefined ? {} : { config }),
    ...(usage === undefined ? {} : { usage }),
  };
};
