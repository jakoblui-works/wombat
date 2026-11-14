import { myDraft } from "@wombat/shared/proposals";

import { currentVersion } from "../store/proposal-rules.ts";
import type { ProposalVersionHead, StoredProposal } from "../store/store.ts";

/** The fields every target's proposal sends alike, from the stored proposal and its versions' heads. */
export const commonFields = (stored: StoredProposal, heads: readonly ProposalVersionHead[]) => {
  const { decidedAt, problem, rejectReason } = stored;
  const current = currentVersion(heads);
  return {
    id: stored.id,
    status: stored.status,
    agentId: stored.agentId,
    reason: stored.reason,
    version: current?.n ?? 1,
    // My version is current: a draft, or the version the proposal was decided on.
    editedByMe: myDraft(heads) !== undefined,
    at: stored.at,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(problem === undefined ? {} : { problem }),
    ...(rejectReason === undefined ? {} : { rejectReason }),
  };
};
