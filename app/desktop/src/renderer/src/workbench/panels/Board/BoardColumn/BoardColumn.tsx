import { Plus } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";
import { newItemLabel } from "../../Desk/view-model/view-model.ts";

type Props = {
  label: string;
  count: number;
  /** A card is held over this column. */
  over: boolean;
  /** Undefined: no "+ New" at its foot. */
  onNewItem: (() => void) | undefined;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode;
};

/** Matches a column's element, so a drag over anything else counts as outside every column. */
export const COLUMN_SELECTOR = "[data-board-column]";

/** One column of a board: its heading, its cards scrolling on their own, and "+ New" at its foot. */
export const BoardColumn = ({ label, count, over, onNewItem, onDragOver, onDrop, children }: Props) => (
  <section
    data-board-column=""
    aria-label={label}
    onDragOver={onDragOver}
    onDrop={onDrop}
    className={cn("flex min-h-0 max-w-80 min-w-48 flex-1 basis-0 flex-col rounded-lg border border-line-subtle bg-surface-1 transition-colors", over && "border-line-strong bg-surface-2")}
  >
    <h3 className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 pb-1.5 text-xs font-medium text-fg-tertiary">
      <span className="min-w-0 truncate">{label}</span>
      <span className="tabular-nums">{count}</span>
    </h3>
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pt-0.5 pb-2">{children}</div>
    {onNewItem === undefined ? null : (
      <div className="shrink-0 border-t border-line-subtle px-2 py-1.5">
        <Button variant="ghost" size="xs" className="text-fg-secondary" aria-label={newItemLabel(label)} title={newItemLabel(label)} onClick={onNewItem}>
          <Plus />
          New
        </Button>
      </div>
    )}
  </section>
);
