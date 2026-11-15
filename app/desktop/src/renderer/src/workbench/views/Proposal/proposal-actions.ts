import { type AgentSummary, chatAccess } from "@wombat/shared/api";
import { canDecide, canDraft, canReject, canRevise, isOpen, type Proposal, type ProposalStatus } from "@wombat/shared/proposals";

import type { ConnectionState } from "../../../../../shared/bridge.ts";
import { featuresOrAssumed } from "../Chat/harness-features.ts";

type ProposalActions = { approve: boolean; reject: boolean; revise: boolean; draft: boolean };

/**
 * Which of a proposal's buttons are enabled. Deciding and drafting need the service, so none is enabled while not
 * connected; Approve and Reject are off while the proposal is being applied (canDecide and canReject say no then).
 * Revising sends the agent a message, so the agent must exist, not be stopped, and take a message at all (`chatAccess`
 * by its harness's `features`, undefined while they are unknown): otherwise the chat would open on a box that can't send.
 */
export const proposalActions = (
  proposal: Pick<Proposal, "status" | "target" | "kind">,
  agent: Pick<AgentSummary, "id" | "state" | "hasProcess"> | undefined,
  connection: ConnectionState["state"],
  features: readonly string[] | undefined,
): ProposalActions => {
  const connected = connection === "connected";
  return {
    approve: connected && canDecide(proposal.status),
    reject: connected && canReject(proposal.status),
    revise: connected && agent !== undefined && agent.state !== "stopped" && chatAccess(agent, featuresOrAssumed(features)) !== "closed" && canRevise(proposal.status),
    // An item delete has no content to edit.
    draft: connected && canDraft(proposal.status) && !(proposal.target === "item" && proposal.kind === "delete"),
  };
};

/** What a proposal shows by its status, in the row and the tab alike. */
export type ProposalShows = {
  /** Approve is offered: open and not a conflict (shown, disabled, while the proposal is being applied). */
  approve: boolean;
  /** Reject is offered: while the proposal is open, a conflict too. */
  reject: boolean;
  /** The state named beside the proposal while it's open and not simply waiting. */
  mark: "Conflict" | "Applying" | undefined;
  /** The decision, once there is one. */
  outcome: { allowed: boolean; label: string } | undefined;
};

// Which decision a closed proposal holds: no predicate tells approved from rejected, so the status names it here, once.
const OUTCOMES: Partial<Record<ProposalStatus, ProposalShows["outcome"]>> = {
  approved: { allowed: true, label: "Approved" },
  rejected: { allowed: false, label: "Rejected" },
};

/**
 * Which buttons and marks a proposal shows, from the shared predicates: a conflict can be revised or rejected but not
 * approved; a proposal being applied is open but can be neither approved nor revised.
 */
export const proposalShows = (status: ProposalStatus): ProposalShows => {
  const open = isOpen(status);
  const conflict = canRevise(status) && !canDecide(status);
  const applying = open && !canRevise(status);
  return {
    approve: open && !conflict,
    reject: open,
    mark: conflict ? "Conflict" : applying ? "Applying" : undefined,
    outcome: open ? undefined : OUTCOMES[status],
  };
};
