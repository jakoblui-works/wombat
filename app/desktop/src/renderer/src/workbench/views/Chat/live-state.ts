// What of the chat is live now, pure. The log alone can't say: a turn that fails, or an agent process that ends, logs
// no `turn_ended`, so its turn and its open requests would look live forever. The agent's summary says what the
// service holds now; but the summary and the log arrive apart, so the summary only ends things, never starts them
// early: a request the summary doesn't list yet stays open (its buttons wait), and a turn the log has begun stays on
// until the summary says the agent has finished. Without a summary (the list is loading) the log is all there is.
import type { AgentSummary } from "@wombat/shared/api";

import type { ChatItem, ChatModel } from "../../../data/chat-model.ts";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;
type RequestRef = Pick<PermissionItem, "requestId" | "answer">;

export type LiveState = {
  /** A turn runs: Send waits, Cancel shows. */
  turnActive: boolean;
  /** The request's outcome as the chat shows it; undefined while it's open. */
  answerOf: (item: RequestRef) => PermissionItem["answer"];
  /** Whether an open request takes an answer now (the agent lists it as pending). */
  canAnswer: (item: RequestRef) => boolean;
};

export const liveState = (model: Pick<ChatModel, "turnActive">, agent: Pick<AgentSummary, "state" | "pendingPermissions"> | undefined): LiveState => {
  if (agent === undefined) return { turnActive: model.turnActive, answerOf: ({ answer }) => answer, canAnswer: ({ answer }) => answer === undefined };
  const finished = agent.state !== "working" && agent.state !== "waiting";
  const pending = new Set(agent.pendingPermissions.map(({ requestId }) => requestId));
  const answerOf = ({ answer }: RequestRef): PermissionItem["answer"] => answer ?? (finished ? "cancelled" : undefined);
  return {
    turnActive: model.turnActive && !finished,
    answerOf,
    canAnswer: (item) => answerOf(item) === undefined && pending.has(item.requestId),
  };
};
