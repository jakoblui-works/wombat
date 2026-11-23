import { useCallback } from "react";

import type { AgentSummary } from "@wombat/shared/api";

import { openAgent } from "../shell/shell-state.ts";
import { useShell } from "../shell/ShellProvider.tsx";
import { tabKey } from "../tabs.ts";
import { useWorkbench } from "../workbench-context.ts";
import { CHAT_PANEL } from "./chat-params.ts";
import { expandShownAgent } from "./collapsed-groups.ts";

/** The oldest open request: the smallest `at`, the first listed of equals. */
const oldestPending = (agent: AgentSummary | undefined): string | undefined => {
  let oldest: AgentSummary["pendingPermissions"][number] | undefined;
  for (const request of agent?.pendingPermissions ?? []) {
    if (oldest === undefined || Date.parse(request.at) < Date.parse(oldest.at)) oldest = request;
  }
  return oldest?.requestId;
};

const chatReveal = (agents: readonly AgentSummary[] | undefined, agentId: string, requestId: string | undefined): string | undefined =>
  requestId ?? oldestPending(agents?.find(({ id }) => id === agentId));

/** The key the open chat reads its reveal by. */
export const chatRevealKey = (agentId: string): string => tabKey(CHAT_PANEL, { agentId });

/** Shows the agent's chat in the middle and its row in the overview; `reveal` (a permission request's id) is revealed in the chat. */
export const useOpenAgent = (): ((agentId: string, reveal?: string) => void) => {
  const { change } = useShell();
  const { reveals, titleContext } = useWorkbench();
  return useCallback(
    (agentId, reveal) => {
      reveals.set(chatRevealKey(agentId), reveal === undefined ? undefined : { target: reveal });
      change((state) => expandShownAgent(openAgent(state, agentId), agentId, titleContext().agents));
    },
    [change, reveals, titleContext],
  );
};

/** Shows the agent's chat and reveals `requestId`, else its oldest open request, among the agents as the page knows them now. */
export const useOpenAgentChat = (): ((agentId: string, requestId?: string) => void) => {
  const show = useOpenAgent();
  const { titleContext } = useWorkbench();
  return useCallback((agentId, requestId) => show(agentId, chatReveal(titleContext().agents, agentId, requestId)), [show, titleContext]);
};
