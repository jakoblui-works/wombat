import type { AgentSummary } from "@wombat/shared/api";
import { isOpen, type Proposal } from "@wombat/shared/proposals";

import { ago } from "../../../lib/ago";
import { isOutsideWorkspace, proposalAgentTitle, proposalKindWord, proposalLabel } from "../../proposals/proposal-label.ts";

export type ProposalRow = {
  key: string;
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
  /** It only points to where it is decided (an item proposal: its binder's view), with no Approve or Reject of its own. */
  notification: boolean;
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
        kind: proposalKindWord(proposal),
        edited: proposal.editedByMe,
        outsideWorkspace: isOutsideWorkspace(proposal),
        agent,
        agentTitle: proposalAgentTitle(proposal, agents),
        ago: ago(proposal.at, now),
        notification: proposal.target === "item",
      };
    });
