import { useCallback } from "react";

import type { AgentSummary } from "@wombat/shared/api";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import { useWorkbench, type WorkbenchContextValue } from "../workbench-context.ts";
import { CHAT_PANEL } from "./chat-params.ts";

/** The agent's oldest open request: the smallest `at`, the first listed of equals. */
const oldestPending = (agent: AgentSummary | undefined): string | undefined => {
  let oldest: AgentSummary["pendingPermissions"][number] | undefined;
  for (const request of agent?.pendingPermissions ?? []) {
    if (oldest === undefined || Date.parse(request.at) < Date.parse(oldest.at)) oldest = request;
  }
  return oldest?.requestId;
};

const chatReveal = (agents: readonly AgentSummary[] | undefined, agentId: string, requestId: string | undefined): string | undefined =>
  requestId ?? oldestPending(agents?.find(({ id }) => id === agentId));

/** Switches to Agents, opens or focuses the agent's chat and reveals `chatReveal`'s request, among the agents as the page knows them now. */
export const openAgentChat = (workbench: WorkbenchContextValue, agentId: string, requestId?: string): void => {
  if (workbench.host === undefined) return;
  workbench.showActivity(AGENTS_ACTIVITY);
  workbench.openTab(CHAT_PANEL, { agentId }, chatReveal(workbench.titleContext().agents, agentId, requestId));
};

export const useOpenAgentChat = (): ((agentId: string, requestId?: string) => void) => {
  const workbench = useWorkbench();
  return useCallback((agentId, requestId) => openAgentChat(workbench, agentId, requestId), [workbench]);
};
