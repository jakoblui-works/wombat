import type { AgentSummary } from "@wombat/shared/api";
import { canDecide, canDraft, canReject, canRevise, type ProposalStatus } from "@wombat/shared/proposals";

import type { ConnectionState } from "../../../../../shared/bridge.ts";

export type ProposalActions = { approve: boolean; reject: boolean; revise: boolean; draft: boolean };

/**
 * Which of a proposal's buttons are enabled. Deciding and drafting need the service, so none is enabled while not
 * connected; Approve and Reject are off while the proposal is being applied (canDecide and canReject say no then).
 * Revising sends the agent a message, so it needs the agent to exist.
 */
export const proposalActions = (
  proposal: { status: ProposalStatus },
  agent: Pick<AgentSummary, "id"> | undefined,
  connection: ConnectionState["state"],
): ProposalActions => {
  const connected = connection === "connected";
  return {
    approve: connected && canDecide(proposal.status),
    reject: connected && canReject(proposal.status),
    revise: connected && agent !== undefined && canRevise(proposal.status),
    draft: connected && canDraft(proposal.status),
  };
};
