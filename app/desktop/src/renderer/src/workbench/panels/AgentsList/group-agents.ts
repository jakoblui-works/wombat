import type { AgentSummary } from "@wombat/shared/api";

import { type AgentState, LIST_GROUP_ORDER, listGroup } from "../../../lib/agent-state";

export type AgentGroup = { state: AgentState; agents: AgentSummary[] };

/** The agent list's groups in order (stopped agents under Done), each newest activity first; empty groups left out. */
export const groupAgents = (agents: readonly AgentSummary[]): AgentGroup[] =>
  LIST_GROUP_ORDER.map((state) => ({
    state,
    agents: agents
      .filter((agent) => listGroup(agent.state) === state)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)),
  })).filter((group) => group.agents.length > 0);
