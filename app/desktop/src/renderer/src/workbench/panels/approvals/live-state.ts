// What of the chat is live now, pure. The log alone can't say: logs written by older services have no `turn_ended`
// after a failed turn or an ended process, so its turn and its open requests would look live forever. The agent's
// summary says what the service holds now; but the summary and the log arrive apart, so the summary only ends things,
// never starts them early: a request the summary doesn't list yet stays open (its buttons wait), and a turn the log has
// begun stays on until the summary says the agent has finished. Without a summary (the list is loading) the log is all
// there is.
import { type AgentSummary, isRunning } from "@wombat/shared/api";

import type { ChatPart, ChatModel } from "../../../data/chat-model.ts";

type PermissionPart = Extract<ChatPart, { kind: "permission" }>;
type RequestRef = Pick<PermissionPart, "requestId" | "answer">;

export type LiveState = {
  /** A turn runs: Send waits, Cancel shows. */
  turnActive: boolean;
  /** The request's outcome as the chat shows it; undefined while it's open. */
  answerOf: (part: RequestRef) => PermissionPart["answer"];
  /** Whether an open request takes an answer now (the agent lists it as pending). */
  canAnswer: (part: RequestRef) => boolean;
  /**
   * Whether the request's answer buttons work now: it takes an answer, the app is connected, and no answer to it is on
   * its way. The one rule for the chat's cards and the diff tab.
   */
  answerable: (part: RequestRef, now: { connected: boolean; pending: boolean }) => boolean;
};

const withAnswerable = (state: Omit<LiveState, "answerable">): LiveState => ({
  ...state,
  answerable: (part, { connected, pending }) => connected && !pending && state.canAnswer(part),
});

export const liveState = (model: Pick<ChatModel, "turnActive">, agent: Pick<AgentSummary, "state" | "pendingPermissions"> | undefined): LiveState => {
  if (agent === undefined) return withAnswerable({ turnActive: model.turnActive, answerOf: ({ answer }) => answer, canAnswer: ({ answer }) => answer === undefined });
  const finished = !isRunning(agent);
  const pending = new Set(agent.pendingPermissions.map(({ requestId }) => requestId));
  const answerOf = ({ answer }: RequestRef): PermissionPart["answer"] => answer ?? (finished ? "cancelled" : undefined);
  return withAnswerable({
    turnActive: model.turnActive && !finished,
    answerOf,
    canAnswer: (part) => answerOf(part) === undefined && pending.has(part.requestId),
  });
};
