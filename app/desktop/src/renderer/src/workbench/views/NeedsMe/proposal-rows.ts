import type { AgentSummary } from "@wombat/shared/api";
import { isOpen, type Proposal } from "@wombat/shared/proposals";

import { ago } from "../../../lib/ago";
import { agentTitle } from "../Chat/chat-params.ts";
import { proposalLabel } from "../Proposal/proposal-label.ts";

/** What the row shows for an agent that no longer exists. */
export const AGENT_DELETED = "agent deleted";

export type ProposalRow = {
  key: string;
  proposal: Proposal;
  label: string;
  outsideWorkspace: boolean;
  agent: AgentSummary | undefined;
  agentTitle: string;
  status: Proposal["status"];
  ago: string;
};

/** The Proposals group's rows: open proposals only, newest first. */
export const proposalRows = (proposals: readonly Proposal[], agents: readonly AgentSummary[], now: number): ProposalRow[] =>
  proposals
    .filter(({ status }) => isOpen(status))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((proposal) => {
      const agent = agents.find(({ id }) => id === proposal.agentId);
      return {
        key: proposal.id,
        proposal,
        label: proposalLabel(proposal),
        outsideWorkspace: proposal.target === "file" && proposal.outsideWorkspace,
        agent,
        agentTitle: agent === undefined ? AGENT_DELETED : agentTitle(agent.id, agent),
        status: proposal.status,
        ago: ago(proposal.at, now),
      };
    });
