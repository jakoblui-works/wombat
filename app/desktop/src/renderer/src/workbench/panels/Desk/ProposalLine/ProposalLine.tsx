import type { ItemProposal } from "@wombat/shared/proposals";
import type { CSSProperties } from "react";

import { cn } from "../../../../lib/utils";
import { DecideButtons } from "../../../proposals/DecideButtons/DecideButtons.tsx";
import { markLabel } from "../../../proposals/proposal-label.ts";
import { useOpenProposal } from "../../../proposals/use-open-proposal.ts";
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
};

type LineProps = Omit<Props, "row" | "outside"> & { proposal: ItemProposal; note: string | undefined };

/** One proposal: its mark (for an update or delete, a button that opens the proposal's tab), `note`, and Approve and Reject. */
const ProposalLine = ({ proposal, note, className, style, tabIndex }: LineProps) => {
  const openProposal = useOpenProposal();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)} style={style}>
      {proposal.kind === "create" ? (
        <span className="text-xs font-medium text-primary">{markLabel(proposal.kind)}</span>
      ) : (
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={() => openProposal(proposal.id)}
          className="focus-ring rounded-sm text-xs font-medium text-primary hover:underline"
        >
          {markLabel(proposal.kind)}
        </button>
      )}
      {note === undefined ? null : <span className="text-xs text-fg-tertiary">{note}</span>}
      <DecideButtons proposal={proposal} className="ml-auto" tabIndex={tabIndex} />
    </div>
  );
};

/**
 * Under a row: a line per open proposal it shows (`proposalLines`), oldest first. An item's row without one shows only
 * that it is outside the filter, when it is (a revealed item); any other row without one, nothing.
 */
export const ProposalLines = ({ row, outside = false, ...line }: Props) => {
  const proposals = proposalLines(row);
  if (proposals.length === 0) {
    return outside && isItemRow(row) ? (
      <p className={cn("text-xs text-fg-tertiary", line.className)} style={line.style}>
        {OUTSIDE_FILTER}
      </p>
    ) : null;
  }
  return proposals.map((proposal, at) => (
    <ProposalLine key={proposal.id} proposal={proposal} note={at === 0 && outside && (isItemRow(row) || isPending(row)) ? OUTSIDE_FILTER : undefined} {...line} />
  ));
};
