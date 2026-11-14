import type { AgentSummary } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";

import { agentTitle } from "../Chat/chat-params.ts";

/** A proposal's label: a file's full absolute path, an item's `structure/handle` (a create has no handle yet: its `file`, else the structure alone). */
export const proposalLabel = (proposal: Proposal): string => {
  if (proposal.target === "file") return proposal.path;
  const name = proposal.handle ?? proposal.file;
  return name === null ? proposal.structure : `${proposal.structure}/${name}`;
};

export const AGENT_DELETED = "agent deleted";

/** Whose proposal it is: its agent's title, or AGENT_DELETED once the agent is gone from `agents`. */
export const proposalAgentTitle = (proposal: Pick<Proposal, "agentId">, agents: readonly AgentSummary[]): string => {
  const agent = agents.find(({ id }) => id === proposal.agentId);
  return agent === undefined ? AGENT_DELETED : agentTitle(agent.id, agent);
};

/** Whether the proposal changes a file outside the workspace (an item never is). */
export const isOutsideWorkspace = (proposal: Proposal): boolean => proposal.target === "file" && proposal.outsideWorkspace;
