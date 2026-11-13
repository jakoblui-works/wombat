// What the user asks the agents to do. Each command refreshes what it changes and leaves the cache to the reads
// that follow: nothing is updated optimistically.
import { mutationOptions, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  AgentSummary,
  type AnswerPermissionRequest,
  ContextBreakdown,
  type SendMessageRequest,
  type SetConfigRequest,
  type StartAgentRequest,
} from "@wombat/shared/api";
import { asError } from "../lib/errors.ts";
import { call } from "./client.ts";
import { keys } from "./keys.ts";
import { forgetAgent } from "./query-client.ts";
import { refresh } from "./refresh.ts";

// The command routes' bodies aren't read: what changed arrives through the agents and the log.
const Ignored = z.unknown();

const agentPath = (agentId: string): string => `/agents/${encodeURIComponent(agentId)}`;

/** A new id for one user action; a retry of that action sends the same one, so the service runs it once. */
export const newCommandId = (): string => {
  // randomUUID exists only in secure contexts, and the app's page isn't one; getRandomValues is everywhere.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export type SendMessageVars = { agentId: string; text: string; commandId: string };
export type StartAgentVars = StartAgentRequest & { text: string; commandId: string };
export type AnswerPermissionVars = { agentId: string; requestId: string; kind: AnswerPermissionRequest["kind"] };
export type SetConfigVars = SetConfigRequest & { agentId: string };

/** The variables of one send, its commandId made now: build them once per user action. */
export const sendMessageVars = (agentId: string, text: string): SendMessageVars => ({ agentId, text, commandId: newCommandId() });

/** The variables of one start, the first message's commandId made now. */
export const startAgentVars = (start: StartAgentRequest & { text: string }): StartAgentVars => ({ ...start, commandId: newCommandId() });

export const sendMessageFn = async ({ agentId, text, commandId }: SendMessageVars): Promise<void> => {
  await call("POST", `${agentPath(agentId)}/messages`, Ignored, { text, commandId } satisfies SendMessageRequest);
};

/** A start's two steps: the agent, which exists from here on, and why its first message wasn't sent, if it wasn't. */
export type StartedAgent = { agent: AgentSummary; sendError: Error | undefined };

/**
 * Starts the agent, then sends it the first message. Rejects only when the agent didn't start: once it exists, a
 * failed send comes back as `sendError`, so the message is sent again to this agent rather than starting another.
 */
export const startAgentFn = async ({ harness, repo, text, commandId }: StartAgentVars): Promise<StartedAgent> => {
  const agent = await call("POST", "/agents", AgentSummary, { harness, repo } satisfies StartAgentRequest);
  try {
    await sendMessageFn({ agentId: agent.id, text, commandId });
    return { agent, sendError: undefined };
  } catch (error) {
    return { agent, sendError: asError(error) };
  }
};

export const answerPermissionFn = async ({ agentId, requestId, kind }: AnswerPermissionVars): Promise<void> => {
  await call("POST", `${agentPath(agentId)}/permissions/${encodeURIComponent(requestId)}`, Ignored, { kind } satisfies AnswerPermissionRequest);
};

/** Sets one of the agent's config options; its new options arrive through the log. */
export const setConfigFn = async ({ agentId, configId, value }: SetConfigVars): Promise<void> => {
  await call("POST", `${agentPath(agentId)}/config`, Ignored, { configId, value } satisfies SetConfigRequest);
};

/** Asks the agent for its context breakdown; a hidden turn, so nothing in the log or the agent list changes. */
export const contextBreakdownFn = (agentId: string): Promise<ContextBreakdown> =>
  call("POST", `${agentPath(agentId)}/context`, ContextBreakdown);

export const cancelTurnFn = async (agentId: string): Promise<void> => {
  await call("POST", `${agentPath(agentId)}/cancel`, Ignored);
};

export const stopAgentFn = async (agentId: string): Promise<void> => {
  await call("POST", `${agentPath(agentId)}/stop`, Ignored);
};

export const deleteAgentFn = async (agentId: string): Promise<void> => {
  await call("DELETE", agentPath(agentId), Ignored);
};

const refreshAgent = (queryClient: QueryClient, agentId: string): Promise<void> =>
  Promise.all([refresh(queryClient, keys.agents), refresh(queryClient, keys.log(agentId))]).then(() => undefined);

// Each command's mutation options (what it calls and what it refreshes after), so they run without React too.

export const startAgentMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: startAgentFn, onSettled: () => refresh(queryClient, keys.agents) });

/** `mutate(sendMessageVars(agentId, text))` per send; a retry passes the same variables. */
export const sendMessageMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: sendMessageFn, onSettled: (_data, _error, { agentId }) => refreshAgent(queryClient, agentId) });

export const answerPermissionMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: answerPermissionFn, onSettled: (_data, _error, { agentId }) => refreshAgent(queryClient, agentId) });

export const setConfigMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: setConfigFn, onSettled: (_data, _error, { agentId }) => refreshAgent(queryClient, agentId) });

// Nothing to refresh: the breakdown is only for the dialog that asked.
export const contextBreakdownMutation = () => mutationOptions({ mutationFn: contextBreakdownFn });

export const cancelTurnMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: cancelTurnFn, onSettled: (_data, _error, agentId: string) => refreshAgent(queryClient, agentId) });

export const stopAgentMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: stopAgentFn, onSettled: (_data, _error, agentId: string) => refreshAgent(queryClient, agentId) });

export const deleteAgentMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: deleteAgentFn,
    onSettled: async (_data, _error, agentId: string) => {
      forgetAgent(queryClient, agentId);
      await refresh(queryClient, keys.agents);
    },
  });

export const useStartAgent = () => useMutation(startAgentMutation(useQueryClient()));
export const useSendMessage = () => useMutation(sendMessageMutation(useQueryClient()));
export const useAnswerPermission = () => useMutation(answerPermissionMutation(useQueryClient()));
export const useSetConfig = () => useMutation(setConfigMutation(useQueryClient()));
export const useContextBreakdown = () => useMutation(contextBreakdownMutation());
export const useCancelTurn = () => useMutation(cancelTurnMutation(useQueryClient()));
export const useStopAgent = () => useMutation(stopAgentMutation(useQueryClient()));
export const useDeleteAgent = () => useMutation(deleteAgentMutation(useQueryClient()));
