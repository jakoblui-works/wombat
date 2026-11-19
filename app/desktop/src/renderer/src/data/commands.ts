// What the user asks the agents to do. Each command refreshes what it changes and leaves the cache to the reads
// that follow: nothing is updated optimistically.
import { mutationOptions, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import type { AgentSummary, AnswerPermissionRequest, ContextBreakdown, SetConfigRequest, StartAgentRequest, UpdateItemRequest } from "@wombat/shared/api";
import type { Item } from "@wombat/shared/items";
import { isOpen, type Proposal, ProposalErrorCode } from "@wombat/shared/proposals";
import { ROUTES } from "@wombat/shared/routes";
import { asError } from "../lib/errors.ts";
import { callRoute, ServiceError } from "./client.ts";
import { keys } from "./keys.ts";
import { forgetAgent } from "./query-client.ts";
import { refresh, refreshItems } from "./refresh.ts";

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

export type SendMessageVars = { agentId: string; text: string; commandId: string; proposalId?: string };
export type StartAgentVars = StartAgentRequest & { text: string; commandId: string };
export type AnswerPermissionVars = { agentId: string; requestId: string; kind: AnswerPermissionRequest["kind"] };
export type SetConfigVars = SetConfigRequest & { agentId: string };

/** The variables of one send, its commandId made now: build them once per user action. */
export const sendMessageVars = (agentId: string, text: string, proposalId?: string): SendMessageVars => ({
  agentId,
  text,
  commandId: newCommandId(),
  ...(proposalId === undefined ? {} : { proposalId }),
});

/** The variables of one start, the first message's commandId made now. */
export const startAgentVars = (start: StartAgentRequest & { text: string }): StartAgentVars => ({ ...start, commandId: newCommandId() });

export const sendMessageFn = async ({ agentId, text, commandId, proposalId }: SendMessageVars): Promise<void> => {
  await callRoute(ROUTES.sendMessage, { params: { id: agentId }, body: { text, commandId, ...(proposalId === undefined ? {} : { proposalId }) } });
};

/** A start's two steps: the agent, which exists from here on, and why its first message wasn't sent, if it wasn't. */
export type StartedAgent = { agent: AgentSummary; sendError: Error | undefined };

/**
 * Starts the agent, then sends it the first message. Rejects only when the agent didn't start: once it exists, a
 * failed send comes back as `sendError`, so the message is sent again to this agent rather than starting another.
 */
export const startAgentFn = async ({ harness, repo, text, commandId }: StartAgentVars): Promise<StartedAgent> => {
  const agent = await callRoute(ROUTES.startAgent, { body: { harness, repo } });
  try {
    await sendMessageFn({ agentId: agent.id, text, commandId });
    return { agent, sendError: undefined };
  } catch (error) {
    return { agent, sendError: asError(error) };
  }
};

export const answerPermissionFn = async ({ agentId, requestId, kind }: AnswerPermissionVars): Promise<void> => {
  await callRoute(ROUTES.answerPermission, { params: { id: agentId, requestId }, body: { kind } });
};

/** Sets one of the agent's config options; its new options arrive through the log. */
export const setConfigFn = async ({ agentId, configId, value }: SetConfigVars): Promise<void> => {
  await callRoute(ROUTES.setConfig, { params: { id: agentId }, body: { configId, value } });
};

/** Asks the agent for its context breakdown; a hidden turn, so nothing in the log or the agent list changes. */
export const contextBreakdownFn = (agentId: string): Promise<ContextBreakdown> =>
  callRoute(ROUTES.contextBreakdown, { params: { id: agentId } });

export const cancelTurnFn = async (agentId: string): Promise<void> => {
  await callRoute(ROUTES.cancelTurn, { params: { id: agentId } });
};

export const stopAgentFn = async (agentId: string): Promise<void> => {
  await callRoute(ROUTES.stopAgent, { params: { id: agentId } });
};

export const deleteAgentFn = async (agentId: string): Promise<void> => {
  await callRoute(ROUTES.deleteAgent, { params: { id: agentId } });
};

type DecideVars = { proposalId: string } & ({ decision: "approve"; version: number } | { decision: "reject"; reason?: string });

/**
 * What an approve of version `sent` came to: "changed" when the proposal is still open at a newer version (the file
 * changed since, and the agent's edits were applied to it again as a version to look at), else "decided".
 */
export const approveOutcome = (sent: number, after: Pick<Proposal, "status" | "version">): "decided" | "changed" =>
  isOpen(after.status) && after.version > sent ? "changed" : "decided";

/** The service refused because the proposal has a newer version than the one the request named. */
const isProposalChanged = (error: unknown): boolean => error instanceof ServiceError && error.code === ProposalErrorCode.enum.proposal_changed;

/**
 * Approves the version the user saw, or rejects. `proposal_changed`, and an approve that made a new version instead,
 * resolve as "changed": the refresh in onSettled shows the new version.
 */
const decideFn = async (vars: DecideVars): Promise<"decided" | "changed"> => {
  try {
    if (vars.decision === "approve") {
      const after = await callRoute(ROUTES.approveProposal, { params: { id: vars.proposalId }, body: { version: vars.version } });
      return approveOutcome(vars.version, after);
    }
    await callRoute(ROUTES.rejectProposal, { params: { id: vars.proposalId }, body: vars.reason === undefined ? {} : { reason: vars.reason } });
    return "decided";
  } catch (error) {
    if (isProposalChanged(error)) return "changed";
    throw error;
  }
};

/** What a draft saves: a file's whole text, or an item's fields (links as ids). */
export type DraftBody = { text: string } | { fields: Record<string, unknown> };

type DraftVars = { proposalId: string } & ({ action: "save"; onVersion: number; body: DraftBody } | { action: "clear" });

/**
 * Saves my text or fields as my version of a proposal, or drops my version. Answers the proposal after it, or
 * "changed" when the save named an agent version that is no longer the latest (the agent revised): the refresh in
 * onSettled shows the new version.
 */
const draftFn = async (vars: DraftVars): Promise<Proposal | "changed"> => {
  const params = { id: vars.proposalId };
  try {
    return vars.action === "save"
      ? await callRoute(ROUTES.saveDraft, { params, body: { onVersion: vars.onVersion, ...vars.body } })
      : await callRoute(ROUTES.clearDraft, { params });
  } catch (error) {
    if (isProposalChanged(error)) return "changed";
    throw error;
  }
};

export type SaveItemVars = UpdateItemRequest & { ref: string };

/** Writes my changed fields of item `ref` on the version they're based on; answers the item as written. */
export const saveItemFn = ({ ref, version, fields }: SaveItemVars): Promise<Item> => callRoute(ROUTES.updateItem, { params: { ref }, body: { version, fields } });

const refreshProposal = (queryClient: QueryClient, proposalId: string): Promise<void> =>
  Promise.all([refresh(queryClient, keys.proposals), refresh(queryClient, keys.proposal(proposalId))]).then(() => undefined);

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

/** The one item write of the item tab and the board; a refused or stale save rejects with the ServiceError. */
export const saveItemMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: saveItemFn, onSettled: () => refreshItems(queryClient) });

const decideMutation = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: decideFn,
    onSettled: (_data, _error, { proposalId }) => refreshProposal(queryClient, proposalId),
  });

const draftMutation = (queryClient: QueryClient) =>
  mutationOptions({ mutationFn: draftFn, onSettled: (_data, _error, { proposalId }) => refreshProposal(queryClient, proposalId) });

export const useStartAgent = () => useMutation(startAgentMutation(useQueryClient()));
export const useSendMessage = () => useMutation(sendMessageMutation(useQueryClient()));
export const useAnswerPermission = () => useMutation(answerPermissionMutation(useQueryClient()));
export const useSetConfig = () => useMutation(setConfigMutation(useQueryClient()));
export const useContextBreakdown = () => useMutation(contextBreakdownMutation());
export const useCancelTurn = () => useMutation(cancelTurnMutation(useQueryClient()));
export const useStopAgent = () => useMutation(stopAgentMutation(useQueryClient()));
export const useDecide = () => useMutation(decideMutation(useQueryClient()));
export const useDraft = () => useMutation(draftMutation(useQueryClient()));
export const useSaveItem = () => useMutation(saveItemMutation(useQueryClient()));
export const useDeleteAgent = () => useMutation(deleteAgentMutation(useQueryClient()));
