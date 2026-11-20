import { ChevronRight } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { cn } from "../../../../lib/utils";
import { ItemRow } from "../ItemRow/ItemRow.tsx";
import { ProposalLines } from "../ProposalLine/ProposalLine.tsx";
import { type FlatRow, rowIndent, TREE_ROW, treeKey } from "../tree-keys.ts";
import { proposalProps, REVEALABLE } from "../use-reveal.ts";
import { useTreeFocus } from "../use-tree-focus.ts";
import type { Row } from "../view-model/view-model.ts";

/** What a view draws one visible row from: its treeitem element (no children yet), the chevron or its room, and its tab stop. */
export type RowParts<N> = { row: FlatRow<N>; treeitem: ReactElement<{ className?: string }>; lead: ReactNode; tabIndex: number; titleStart: number };

type Props<N> = {
  label: string;
  rows: readonly FlatRow<N>[];
  onToggle: (key: string, open: boolean) => void;
  onActivate: (row: FlatRow<N>) => void;
  children: (parts: RowParts<N>) => ReactNode;
};

/** The chevron's width and the gap after it, in pixels. */
const LEAD_PX = 14 + 6;

/** A view's visible rows as one tree (the WAI-ARIA tree pattern): one line each, the tree's keys, one tab stop. */
export const ItemTree = <N,>({ label, rows, onToggle, onActivate, children }: Props<N>) => {
  const focus = useTreeFocus(rows.map(({ key }) => key));
  const folds = rows.some(({ expanded }) => expanded !== undefined);

  const act = (index: number, key: string, event?: KeyboardEvent) => {
    const row = rows[index];
    const action = treeKey(rows, index, key);
    if (row === undefined || action === undefined) return;
    event?.preventDefault();
    if (action.type === "focus") {
      const target = rows[action.index];
      if (target !== undefined) focus.focus(target.key);
    } else if (action.type === "toggle") onToggle(row.key, action.open);
    else onActivate(row);
  };

  return (
    <div role="tree" aria-label={label} className="flex flex-col gap-px px-1.5 pt-1 pb-3">
      {rows.map((row, index) => {
        const lead = !folds ? null : (
          <span
            aria-hidden
            className="flex h-5 w-3.5 shrink-0 items-center justify-center"
            onClick={(event) => {
              if (row.expanded === undefined) return;
              event.stopPropagation();
              onToggle(row.key, !row.expanded);
            }}
          >
            {row.expanded === undefined ? null : <ChevronRight className={cn("size-3.5 text-fg-tertiary transition-transform", row.expanded && "rotate-90")} />}
          </span>
        );
        const treeitem = (
          <div
            ref={focus.register(row.key)}
            role="treeitem"
            aria-level={row.level}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-expanded={row.expanded}
            tabIndex={focus.tabIndex(index)}
            onFocus={() => focus.onFocus(row.key)}
            onClick={() => act(index, "Enter")}
            onKeyDown={(event) => act(index, event.key, event)}
            className={cn(TREE_ROW, "h-7")}
            style={{ paddingLeft: rowIndent(row.level) }}
          />
        );
        return <Fragment key={row.key}>{children({ row, treeitem, lead, tabIndex: focus.tabIndex(index), titleStart: rowIndent(row.level) + (folds ? LEAD_PX : 0) })}</Fragment>;
      })}
    </div>
  );
};

type ItemTreeRowProps = {
  parts: RowParts<unknown>;
  node: Row;
  /** The view's filter would hide the row (`isOutsideFilter`). */
  outside: boolean;
  /** Shown on hover or focus at the row's end (a tree row's "New child"). */
  action?: ReactNode;
};

/** One row of a view's items: its line (`ItemRow`), an action on hover or focus, and its proposals' lines under it. */
export const ItemTreeRow = ({ parts: { treeitem, lead, tabIndex, titleStart }, node, outside, action }: ItemTreeRowProps) => (
  <div {...proposalProps(node)} className={cn(REVEALABLE, "group/row relative")}>
    <ItemRow row={node} render={treeitem} lead={lead} />
    {action}
    <ProposalLines row={node} outside={outside} tabIndex={tabIndex} className="pr-2 pb-1" style={{ paddingLeft: titleStart }} />
  </div>
);

/** The classes of an action at a row's end, shown on hover or focus within the row. */
export const ROW_ACTION = "absolute top-0.5 right-1 bg-surface-1 text-fg-tertiary opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100";
