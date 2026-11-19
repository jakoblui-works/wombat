import type { CSSProperties } from "react";

import { cn } from "../../../../lib/utils";
import { DecideButtons } from "../../../proposals/DecideButtons/DecideButtons.tsx";
import { markLabel } from "../../../proposals/proposal-label.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { isPending, type Row } from "../view-model/view-model.ts";
import { OUTSIDE_FILTER } from "../view-model/with-proposals.ts";

type Props = {
  row: Row;
  outside?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Its buttons' tab stop, as the row's own (a tree's roving one). */
  tabIndex?: number | undefined;
  /** Answers true for a press that only ended a board's keyboard hold: the button then does nothing. */
  swallowed?: () => boolean;
};

/**
 * Under a row or card holding a proposal: its mark (for an update or delete, a button that opens the proposal's tab),
 * whether the view's filter would hide it, and Approve and Reject. Nothing for a row without one.
 */
export const ProposalLine = ({ row, outside = false, className, style, tabIndex, swallowed = () => false }: Props) => {
  const { openProposal } = useWorkbench();
  const proposal = isPending(row) ? row.pending : row.proposal;
  if (proposal === undefined) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)} style={style}>
      {isPending(row) ? (
        <span className="text-xs font-medium text-primary">{markLabel("create")}</span>
      ) : (
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={() => swallowed() || openProposal(proposal.id)}
          className="focus-ring rounded-sm text-xs font-medium text-primary hover:underline"
        >
          {markLabel(proposal.kind)}
        </button>
      )}
      {outside ? <span className="text-xs text-fg-tertiary">{OUTSIDE_FILTER}</span> : null}
      <DecideButtons proposal={proposal} className="ml-auto" tabIndex={tabIndex} swallowed={swallowed} />
    </div>
  );
};
