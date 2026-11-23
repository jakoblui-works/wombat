import type { AgentSummary, Workspace } from "@wombat/shared/api";
import { isOpen, type Proposal } from "@wombat/shared/proposals";

import { ago } from "../../../lib/ago";
import { isOutsideWorkspace, proposalAgentTitle, proposalKindWord, proposalLabel } from "../../proposals/proposal-label.ts";

export type ProposalRow = {
  type: "proposal";
  key: string;
  workspace: string;
  at: string;
  proposal: Proposal;
  label: string;
  /** "new file", "new item" or "delete"; undefined for an edit or update. */
  kind: string | undefined;
  /** Its current version is mine. */
  edited: boolean;
  outsideWorkspace: boolean;
  agent: AgentSummary | undefined;
  agentTitle: string;
  ago: string;
};

/** The open proposals' rows, in the list's order (`allRows` orders Needs me). */
export const proposalRows = (proposals: readonly Proposal[], agents: readonly AgentSummary[], workspaces: readonly Workspace[] | undefined, now: number): ProposalRow[] =>
  proposals
    .filter(({ status }) => isOpen(status))
    .map((proposal) => {
      const agent = agents.find(({ id }) => id === proposal.agentId);
      return {
        type: "proposal",
        key: proposal.id,
        workspace: proposal.workspace,
        at: proposal.at,
        proposal,
        label: proposalLabel(proposal),
        kind: proposalKindWord(proposal),
        edited: proposal.editedByMe,
        outsideWorkspace: isOutsideWorkspace(proposal),
        agent,
        agentTitle: proposalAgentTitle(proposal, agents, workspaces),
        ago: ago(proposal.at, now),
      };
    });
