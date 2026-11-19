import type { ItemProposal } from "@wombat/shared/proposals";
import type { CSSProperties } from "react";

import { cn } from "../../../../lib/utils";
import { DecideButtons } from "../../../proposals/DecideButtons/DecideButtons.tsx";
import { markLabel } from "../../../proposals/proposal-label.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { isItemRow, isPending, type Row } from "../view-model/view-model.ts";
import { OUTSIDE_FILTER, proposalLines } from "../view-model/with-proposals.ts";

type Props = {
  row: Row;
  /** The view's filter would hide the row: its first line says so (a missing item's row says what it is instead). */
  outside?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Its buttons' tab stop, as the row's own (a tree's roving one). */
  tabIndex?: number | undefined;
  /** Answers true for a press that only ended a board's keyboard hold: the button then does nothing. */
  swallowed?: () => boolean;
};

type LineProps = Omit<Props, "row" | "outside"> & { proposal: ItemProposal; note: string | undefined };

/** One proposal: its mark (for an update or delete, a button that opens the proposal's tab), `note`, and Approve and Reject. */
const ProposalLine = ({ proposal, note, className, style, tabIndex, swallowed = () => false }: LineProps) => {
  const { openProposal } = useWorkbench();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)} style={style}>
      {proposal.kind === "create" ? (
        <span className="text-xs font-medium text-primary">{markLabel(proposal.kind)}</span>
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
      {note === undefined ? null : <span className="text-xs text-fg-tertiary">{note}</span>}
      <DecideButtons proposal={proposal} className="ml-auto" tabIndex={tabIndex} swallowed={swallowed} />
    </div>
  );
};

/** Under a row or card: a line per open proposal it shows (`proposalLines`), oldest first. Nothing for a row without one. */
export const ProposalLines = ({ row, outside = false, ...line }: Props) =>
  proposalLines(row).map((proposal, at) => (
    <ProposalLine key={proposal.id} proposal={proposal} note={at === 0 && outside && (isItemRow(row) || isPending(row)) ? OUTSIDE_FILTER : undefined} {...line} />
  ));
