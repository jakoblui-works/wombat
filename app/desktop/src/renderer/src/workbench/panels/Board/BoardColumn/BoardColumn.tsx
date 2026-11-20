import { Plus } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";
import { newItemLabel } from "../../Desk/view-model/view-model.ts";

type Props = {
  label: string;
  /** The items it holds (`itemCount`). */
  count: number;
  /** It shows no card: a drop area instead. */
  empty: boolean;
  /** A card is held over this column. */
  over: boolean;
  /** Undefined: no "+" in its header. */
  onNewItem: (() => void) | undefined;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode;
};

/** Matches a column's element, so a drag over anything else counts as outside every column. */
export const COLUMN_SELECTOR = "[data-board-column]";

/** One column of a board, a fixed-width lane: its name, count and "+" in its header, its cards scrolling on their own. */
export const BoardColumn = ({ label, count, empty, over, onNewItem, onDragOver, onDrop, children }: Props) => (
  <section
    data-board-column=""
    aria-label={label}
    onDragOver={onDragOver}
    onDrop={onDrop}
    className={cn("flex min-h-0 w-board-lane shrink-0 flex-col rounded-lg bg-surface-0 transition-shadow", over && "ring-2 ring-primary/40")}
  >
    <div className="flex shrink-0 items-center gap-2 pt-4 pr-3 pb-3 pl-5">
      <h3 className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold text-fg-primary">
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-sm font-normal text-fg-tertiary tabular-nums">{count}</span>
      </h3>
      {onNewItem === undefined ? null : (
        <Button variant="ghost" size="icon-xs" className="text-fg-tertiary" aria-label={newItemLabel(label)} title={newItemLabel(label)} onClick={onNewItem}>
          <Plus />
        </Button>
      )}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain px-3 pt-1 pb-3">
      {empty ? <div aria-hidden className="h-20 shrink-0 rounded-md border border-dashed border-line-strong" /> : null}
      {children}
    </div>
  </section>
);
