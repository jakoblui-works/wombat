import type { ProposalVersionHead, StoredProposal } from "../store/store.ts";

/** The fields every target's proposal sends alike, from the stored proposal and its versions' heads. */
export const commonFields = (stored: StoredProposal, heads: readonly ProposalVersionHead[]) => {
  const { decidedAt, problem, rejectReason } = stored;
  return {
    id: stored.id,
    status: stored.status,
    agentId: stored.agentId,
    reason: stored.reason,
    version: heads.at(-1)?.n ?? 1,
    editedByMe: heads.some((head) => head.by === "me"),
    at: stored.at,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(problem === undefined ? {} : { problem }),
    ...(rejectReason === undefined ? {} : { rejectReason }),
  };
};
