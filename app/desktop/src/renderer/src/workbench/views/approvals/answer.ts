// Answering one agent's permission requests: the one answer action, used by the chat's cards and the diff tab. Every
// answer is a mutation under `answerKey(agentId)`, so whoever shows a request reads the same per-request state from
// the mutation cache.
import { type Mutation, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import type { AnswerPermissionRequest } from "@wombat/shared/api";
import { useMemo } from "react";

import { answerPermissionMutation, type AnswerPermissionVars } from "../../../data/commands.ts";

export const answerKey = (agentId: string) => ["answer", agentId] as const;

/** One answer as the cache holds it. */
export type AnswerAttempt = { requestId: string | undefined; pending: boolean; error: Error | null; submittedAt: number };

export type AnswerState = { pending: boolean; error: Error | undefined };

/** A request's answer state: its latest attempt's (an earlier attempt's failure is gone once it's tried again). */
export const answerState = (attempts: readonly AnswerAttempt[], requestId: string): AnswerState => {
  let latest: AnswerAttempt | undefined;
  for (const attempt of attempts) if (attempt.requestId === requestId && (latest === undefined || attempt.submittedAt >= latest.submittedAt)) latest = attempt;
  return { pending: latest?.pending ?? false, error: latest?.error ?? undefined };
};

const attemptOf = (mutation: Mutation<unknown, Error, AnswerPermissionVars>): AnswerAttempt => ({
  requestId: mutation.state.variables?.requestId,
  pending: mutation.state.status === "pending",
  error: mutation.state.error,
  submittedAt: mutation.state.submittedAt,
});

export const useAnswer = (agentId: string) => {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({ ...answerPermissionMutation(queryClient), mutationKey: answerKey(agentId) });
  const attempts = useMutationState({
    filters: { mutationKey: answerKey(agentId) },
    select: (mutation) => attemptOf(mutation as Mutation<unknown, Error, AnswerPermissionVars>),
  });
  return useMemo(
    () => ({
      /** Sends the answer; the request's outcome arrives through the log. */
      answer: (requestId: string, kind: AnswerPermissionRequest["kind"]): void => mutate({ agentId, requestId, kind }),
      /** Whether an answer to this request is on its way, and why its last one failed. */
      stateOf: (requestId: string): AnswerState => answerState(attempts, requestId),
    }),
    [agentId, mutate, attempts],
  );
};
