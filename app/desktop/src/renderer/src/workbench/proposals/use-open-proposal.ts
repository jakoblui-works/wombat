import { useCallback } from "react";

import { useWorkbench, type WorkbenchContextValue } from "../workbench-context.ts";
import { PROPOSAL_PANEL, type ProposalParams } from "./proposal-params.ts";

/** Opens or focuses the proposal's tab, kept. */
export const openProposal = (workbench: WorkbenchContextValue, proposalId: string): void => {
  if (workbench.host === undefined) return;
  workbench.openTab(PROPOSAL_PANEL, { proposalId } satisfies ProposalParams);
};

export const useOpenProposal = (): ((proposalId: string) => void) => {
  const workbench = useWorkbench();
  return useCallback((proposalId) => openProposal(workbench, proposalId), [workbench]);
};
