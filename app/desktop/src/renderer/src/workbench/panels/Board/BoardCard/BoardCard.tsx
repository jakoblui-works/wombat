import type { ItemSummary } from "@wombat/shared/items";
import { type DragEvent, type FocusEvent, type KeyboardEvent, useEffect, useRef } from "react";

import { cn } from "../../../../lib/utils";
import { ItemRow } from "../../Desk/ItemRow/ItemRow.tsx";
import type { CardMode } from "../board-drag.ts";

type Props = {
  item: ItemSummary;
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
};

const CARD = "flex w-full items-start gap-2 rounded-md border border-line bg-surface-0 px-2.5 py-2 text-left text-sm";
const HELD = "border-primary bg-primary/10 ring-2 ring-primary/40";

/** One item on a board: a button that opens it, and a native drag source. */
export const BoardCard = ({ item, mode, movable, focus, onOpen, onDragStart, onDragEnd, onBlur, onKeyDown }: Props) => {
  const ref = useRef<HTMLButtonElement>(null);
  const held = mode === "held";
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);

  if (mode === "preview") return <ItemRow item={item} wrap render={<div className={cn(CARD, HELD)} />} />;
  return (
    <ItemRow
      item={item}
      wrap
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
          className={cn(CARD, "focus-ring transition-colors select-none hover:bg-surface-2", held && HELD)}
        />
      }
    />
  );
};
