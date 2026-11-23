// What waits on the user: every open permission request of a waiting agent, or the waiting agent itself.
import { type AgentSummary, isWaiting } from "@wombat/shared/api";
import { isOpen, type Proposal } from "@wombat/shared/proposals";

export type NeedsMeItem = { agentId: string; requestId: string; title: string; at: string } | { agentId: string; at: string };

/** Newest first by `at`, ties by agent id. */
export const needsMe = (agents: AgentSummary[]): NeedsMeItem[] =>
  agents
    .filter(isWaiting)
    .flatMap((agent): NeedsMeItem[] =>
      agent.pendingPermissions.length === 0
        ? [{ agentId: agent.id, at: agent.lastActivityAt }]
        : agent.pendingPermissions.map(({ requestId, title, at }) => ({ agentId: agent.id, requestId, title, at })),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));

/** Needs me's count: requests plus open proposals. */
export const needsMeCount = (agents: AgentSummary[], proposals: readonly Pick<Proposal, "status">[]): number =>
  needsMe(agents).length + proposals.filter(({ status }) => isOpen(status)).length;
