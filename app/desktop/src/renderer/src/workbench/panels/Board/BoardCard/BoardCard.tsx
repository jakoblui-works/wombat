import { type DragEvent, type FocusEvent, type KeyboardEvent, useEffect, useRef } from "react";

import { cn } from "../../../../lib/utils";
import { proposedTitle } from "../../../proposals/proposal-label.ts";
import { ItemRow, PendingItemRow } from "../../Desk/ItemRow/ItemRow.tsx";
import { ProposalLine } from "../../Desk/ProposalLine/ProposalLine.tsx";
import { proposalProps, REVEALABLE } from "../../Desk/use-reveal.ts";
import type { ItemRow as ItemRowData, PendingRow } from "../../Desk/view-model/view-model.ts";
import { struck } from "../../Desk/view-model/with-proposals.ts";
import type { CardMode } from "../board-drag.ts";

type Props = {
  row: ItemRowData;
  mode: CardMode;
  /** Whether it can be dragged (`canMove`). */
  movable: boolean;
  /** The card takes focus as it renders (it moves between columns by keyboard). */
  focus: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Answers true for a press on the proposal's buttons that only ended a keyboard hold. */
  swallowed: () => boolean;
};

const FRAME = "rounded-md border border-line bg-surface-0 text-sm";
const CARD = cn(FRAME, "flex w-full items-start gap-2 px-2.5 py-2 text-left");
/** A card's button inside the frame of a card holding a proposal, the proposal's line below it. */
const FRAMED = "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left";
const HELD = "border-primary bg-primary/10 ring-2 ring-primary/40";
const LINE = "px-2.5 pb-2";

/** One item on a board: a button that opens it, and a native drag source; a proposal on it below, in the same frame. */
export const BoardCard = ({ row, mode, movable, focus, onOpen, onDragStart, onDragEnd, onBlur, onKeyDown, swallowed }: Props) => {
  const ref = useRef<HTMLButtonElement>(null);
  const held = mode === "held";
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const { item, proposal } = row;
  const isStruck = struck(row);

  if (mode === "preview") return <ItemRow item={item} wrap struck={isStruck} render={<div className={cn(CARD, HELD)} />} />;
  const card = (
    <ItemRow
      item={item}
      wrap
      struck={isStruck}
      render={
        <button
          ref={ref}
          type="button"
          draggable={movable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onKeyUp={(event) => {
            // A button clicks on Space's keyup; Space only picks up and drops a card.
            if (event.key === " ") event.preventDefault();
          }}
          onClick={onOpen}
          className={cn(proposal === undefined ? CARD : FRAMED, "focus-ring transition-colors select-none hover:bg-surface-2", held && proposal === undefined && HELD)}
        />
      }
    />
  );
  if (proposal === undefined) return card;
  return (
    <div {...proposalProps(row)} className={cn(FRAME, REVEALABLE, held && HELD)}>
      {card}
      <ProposalLine row={row} className={LINE} swallowed={swallowed} />
    </div>
  );
};

/** A proposed create on a board: a button that opens the proposal, never dragged, and its Approve and Reject. */
export const PendingCard = ({ row, outside, onOpen, swallowed }: { row: PendingRow; outside: boolean; onOpen: () => void; swallowed: () => boolean }) => (
  <div {...proposalProps(row)} className={cn(FRAME, REVEALABLE)}>
    <PendingItemRow title={proposedTitle(row.fields)} wrap render={<button type="button" onClick={onOpen} className={cn(FRAMED, "focus-ring transition-colors select-none hover:bg-surface-2")} />} />
    <ProposalLine row={row} outside={outside} className={LINE} swallowed={swallowed} />
  </div>
);
