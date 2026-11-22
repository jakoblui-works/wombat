import type { Problem } from "@wombat/shared/items";
import type { ProposalDetail } from "@wombat/shared/proposals";

import { proposalShows, type ProposalShows } from "../../proposals/proposal-actions.ts";

export type ProposalTabState = ProposalShows & {
  /** The decision with the reject reason, if any. */
  reason: string | undefined;
  /** Why it couldn't be applied, while it's open. */
  problem: Problem | undefined;
  /** An edit whose file can't be read now (gone, or not text that fits): there is no file to diff against. */
  fileUnreadable: boolean;
  /**
   * The file is no longer the version the current version was made on (only while Approve is offered): `"mine"` when
   * my version is current, which holds no edits to apply again, so Approve ends in a conflict; `"agent"` otherwise,
   * where Approve applies the agent's edits again if they still fit, and ends in a conflict if not.
   */
  changedSince: "agent" | "mine" | undefined;
};

/** What the proposal tab shows for `proposal` beside its body. */
export const proposalTabState = (proposal: ProposalDetail): ProposalTabState => {
  const shows = proposalShows(proposal.status);
  const fileUnreadable = proposal.target === "file" && proposal.kind === "edit" && proposal.current === null;
  return {
    ...shows,
    reason: shows.outcome === undefined ? undefined : proposal.rejectReason,
    problem: shows.outcome === undefined ? proposal.problem : undefined,
    fileUnreadable,
    changedSince: shows.approve && !fileUnreadable && proposal.target === "file" && proposal.baseChanged === true ? (proposal.editedByMe ? "mine" : "agent") : undefined,
  };
};
