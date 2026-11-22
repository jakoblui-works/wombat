import { useCallback } from "react";

import type { AgentSummary } from "@wombat/shared/api";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import { useWorkbench, type WorkbenchContextValue } from "../workbench-context.ts";
import { CHAT_PANEL } from "./chat-params.ts";

/** The agent's oldest open request: the smallest `at`, the first listed of equals. */
export const oldestPending = (agent: AgentSummary | undefined): string | undefined => {
  let oldest: AgentSummary["pendingPermissions"][number] | undefined;
  for (const request of agent?.pendingPermissions ?? []) {
    if (oldest === undefined || Date.parse(request.at) < Date.parse(oldest.at)) oldest = request;
  }
  return oldest?.requestId;
};

/** What the chat reveals: `requestId`, else the agent's oldest pending permission request. */
export const chatReveal = (agents: readonly AgentSummary[] | undefined, agentId: string, requestId: string | undefined): string | undefined =>
  requestId ?? oldestPending(agents?.find(({ id }) => id === agentId));

/** Switches to Agents, opens or focuses the agent's chat and reveals `chatReveal`'s request. */
export const openAgentChat = (workbench: WorkbenchContextValue, agents: readonly AgentSummary[] | undefined, agentId: string, requestId?: string): void => {
  if (workbench.host === undefined) return;
  workbench.showActivity(AGENTS_ACTIVITY);
  workbench.openTab(CHAT_PANEL, { agentId }, chatReveal(agents, agentId, requestId));
};

/** `openAgentChat` with the agents as the page knows them when it's called. */
export const useOpenAgentChat = (): ((agentId: string, requestId?: string) => void) => {
  const workbench = useWorkbench();
  return useCallback((agentId, requestId) => openAgentChat(workbench, workbench.titleContext().agents, agentId, requestId), [workbench]);
};
