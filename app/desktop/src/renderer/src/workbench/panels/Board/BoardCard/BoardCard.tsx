import type { LenientView } from "@wombat/shared/items";
import { type DragEvent, type FocusEvent, type KeyboardEvent, useEffect, useRef } from "react";

import { cn } from "../../../../lib/utils";
import { ItemCard } from "../../Desk/ItemCard/ItemCard.tsx";
import { ProposalLines } from "../../Desk/ProposalLine/ProposalLine.tsx";
import { proposalProps, REVEALABLE } from "../../Desk/use-reveal.ts";
import type { ItemRow, MissingRow, PendingRow, Properties } from "../../Desk/view-model/view-model.ts";
import type { CardMode } from "../board-drag.ts";

/** The view the card is in and its binder's properties, which choose what the card shows. */
type Shown = { view: LenientView; properties: Properties };

type Props = Shown & {
  row: ItemRow;
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
  /** The view's filter would hide it (it shows for its proposals). */
  outside: boolean;
};

const FRAME = "rounded-md border border-line bg-surface-0 text-sm";
const CARD = cn(FRAME, "w-full px-2.5 py-2 text-left");
/** A card's button inside the frame of a card holding a proposal, the proposal's line below it. */
const FRAMED = "w-full rounded-md px-2.5 py-2 text-left";
const HELD = "border-primary bg-primary/10 ring-2 ring-primary/40";
const LINE = "px-2.5 pb-2";

/** One item on a board: a button that opens it, and a native drag source; a proposal on it below, in the same frame. */
export const BoardCard = ({ row, view, properties, mode, movable, focus, onOpen, onDragStart, onDragEnd, onBlur, onKeyDown, swallowed, outside }: Props) => {
  const ref = useRef<HTMLButtonElement>(null);
  const held = mode === "held";
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const { proposal } = row;

  if (mode === "preview") return <ItemCard row={row} view={view} properties={properties} render={<div className={cn(CARD, HELD)} />} />;
  const card = (
    <ItemCard
      row={row}
      view={view}
      properties={properties}
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
      <ProposalLines row={row} outside={outside} className={LINE} swallowed={swallowed} />
    </div>
  );
};

/** A proposed create or a missing item on a board: a button that opens the proposal, never dragged, and its proposals' lines. */
export const ProposalCard = ({
  row,
  view,
  properties,
  outside,
  onOpen,
  swallowed,
}: Shown & { row: PendingRow | MissingRow; outside: boolean; onOpen: () => void; swallowed: () => boolean }) => (
  <div {...proposalProps(row)} className={cn(FRAME, REVEALABLE)}>
    <ItemCard
      row={row}
      view={view}
      properties={properties}
      render={<button type="button" onClick={onOpen} className={cn(FRAMED, "focus-ring transition-colors select-none hover:bg-surface-2")} />}
    />
    <ProposalLines row={row} outside={outside} className={LINE} swallowed={swallowed} />
  </div>
);
