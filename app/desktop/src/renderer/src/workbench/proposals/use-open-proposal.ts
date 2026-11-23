import { useCallback } from "react";

import { useWorkbench, type WorkbenchContextValue } from "../workbench-context.ts";
import { PROPOSAL_PANEL, type ProposalParams } from "./proposal-params.ts";

type OpenProposalOptions = { workspace?: string | undefined };

/** Opens or focuses the proposal's tab, kept, in `workspace`'s strip (default: the shown workspace's). */
export const openProposal = (workbench: WorkbenchContextValue, proposalId: string, { workspace }: OpenProposalOptions = {}): void => {
  workbench.openTab(PROPOSAL_PANEL, { proposalId } satisfies ProposalParams, undefined, { workspace });
};

export const useOpenProposal = (): ((proposalId: string, options?: OpenProposalOptions) => void) => {
  const workbench = useWorkbench();
  return useCallback((proposalId, options) => openProposal(workbench, proposalId, options), [workbench]);
};
