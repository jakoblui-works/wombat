import { ChevronRight, Plus } from "lucide-react";
import { type AriaAttributes, Fragment, type KeyboardEvent, type ReactElement, type ReactNode, useRef } from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";
import { useCommandScope } from "../../../commands/registry.ts";
import type { Reveal } from "../../../registry.ts";
import { DESK_COMMAND, DESK_ROW_SCOPE } from "../desk-commands.ts";
import type { PreviewTarget } from "../ItemPreview/item-preview.ts";
import { useRowPreview } from "../ItemPreview/use-row-preview.tsx";
import { ItemRow } from "../ItemRow/ItemRow.tsx";
import { ProposalLines } from "../ProposalLine/ProposalLine.tsx";
import { FIRST_LINE_BOX, type FlatRow, rowIndent, TREE_ROW, treeChevron, treeKey } from "../tree-keys.ts";
import { proposalProps, REVEALABLE, useReveal } from "../use-reveal.ts";
import { useTreeFocus } from "../use-tree-focus.ts";
import type { RowContent } from "../view-model/row-content.ts";
import type { Row } from "../view-model/view-model.ts";

/**
 * What a view draws one visible row from: its treeitem element (no children yet), the chevron or its room, its tab
 * stop, and whether the row grows to hold a wrapped title.
 */
export type RowParts<N> = { row: FlatRow<N>; treeitem: ReactElement<AriaAttributes>; lead: ReactNode; tabIndex: number; titleStart: number; wraps: boolean };

type Props<N> = {
  label: string;
  rows: readonly FlatRow<N>[];
  onToggle: (key: string, open: boolean) => void;
  /** A click on the row, or the open command on the focused row (Enter). */
  onOpen: (row: FlatRow<N>) => void;
  /** What a row's preview box shows; none for a row without one. */
  previewOf?: ((row: FlatRow<N>) => PreviewTarget | undefined) | undefined;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
  /** Rows grow to hold their whole title (a list's); else each is one line (a tree's). */
  wraps?: boolean;
  children: (parts: RowParts<N>) => ReactNode;
};

const LEAD_ROOM = cn(FIRST_LINE_BOX, "w-3.5 justify-center");
const ROW_BASE = "flex min-w-0 gap-1.5";
const ROW_LINE = cn(ROW_BASE, "h-7 items-center");
// Top-aligned: the chevron and marks sit in the first line (`FIRST_LINE_BOX`), py-1 around it makes the line's h-7.
const ROW_GROWS = cn(ROW_BASE, "min-h-7 items-start py-1");
// LEAD_PX must match LEAD_ROOM's width (w-3.5) and ROW_BASE's gap (gap-1.5): the proposal lines line up with the title by it.
const LEAD_PX = 14 + 6;

const ROW_KEY_ATTRIBUTE = "data-row-key";

/**
 * A view's visible rows as one tree (the WAI-ARIA tree pattern): one line each or growing (`wraps`), the tree's keys,
 * one tab stop; the row holding proposal `reveal` is shown (`useReveal`); one preview box for its rows (`useRowPreview`).
 * The tree is a `desk.row` command scope.
 */
export const ItemTree = <N,>({ label, rows, onToggle, onOpen, previewOf, reveal, onRevealed, wraps = false, children }: Props<N>) => {
  const focus = useTreeFocus(rows.map(({ key }) => key));
  const ref = useRef<HTMLDivElement>(null);
  useReveal(reveal, ref, onRevealed);
  const folds = rows.some(({ expanded }) => expanded !== undefined);
  const preview = useRowPreview({ rows, previewOf, onOpen, within: ref });
  const keyOf = (element: Element) => element.closest(`[${ROW_KEY_ATTRIBUTE}]`)?.getAttribute(ROW_KEY_ATTRIBUTE) ?? undefined;
  const scope = useCommandScope(DESK_ROW_SCOPE, {
    [DESK_COMMAND.open]: (element) => {
      const key = keyOf(element);
      const row = rows.find((each) => each.key === key);
      if (row !== undefined) preview.open(row);
    },
    [DESK_COMMAND.preview]: (element) => {
      const key = keyOf(element);
      if (key !== undefined) preview.toggle(key);
    },
  });

  const act = (index: number, key: string, event: KeyboardEvent) => {
    const row = rows[index];
    const action = treeKey(rows, index, key);
    if (row === undefined || action === undefined) return;
    event.preventDefault();
    if (action.type === "focus") {
      const target = rows[action.index];
      if (target !== undefined) focus.focus(target.key);
    } else onToggle(row.key, action.open);
  };

  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>
      ) : (
        <div {...scope} role="tree" aria-label={label} onBlur={preview.onBlur} className="flex flex-col gap-px px-1.5 pt-1 pb-3">
          {rows.map((row, index) => {
            const lead = !folds ? null : (
              <span
                aria-hidden
                className={LEAD_ROOM}
                onClick={(event) => {
                  if (row.expanded === undefined) return;
                  event.stopPropagation();
                  onToggle(row.key, !row.expanded);
                }}
              >
                {row.expanded === undefined ? null : <ChevronRight className={treeChevron(row.expanded)} />}
              </span>
            );
            const treeitem = preview.trigger(
              row,
              <div
                ref={focus.register(row.key)}
                role="treeitem"
                {...{ [ROW_KEY_ATTRIBUTE]: row.key }}
                aria-level={row.level}
                aria-setsize={row.setSize}
                aria-posinset={row.posInSet}
                aria-expanded={row.expanded}
                tabIndex={focus.tabIndex(index)}
                onFocus={() => {
                  focus.onFocus(row.key);
                  preview.follow(row.key);
                }}
                onClick={() => preview.open(row)}
                onKeyDown={(event) => act(index, event.key, event)}
                className={cn(TREE_ROW, wraps ? ROW_GROWS : ROW_LINE)}
                style={{ paddingLeft: rowIndent(row.level) }}
              />,
            );
            const titleStart = rowIndent(row.level) + (folds ? LEAD_PX : 0);
            return <Fragment key={row.key}>{children({ row, treeitem, lead, tabIndex: focus.tabIndex(index), titleStart, wraps })}</Fragment>;
          })}
        </div>
      )}
      {preview.box}
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
  /** The row is one of a rich list's (`richRows`): a hairline under it. */
  rich?: boolean;
  /** What an item's rich row shows in its title's place (`rowContent`). */
  content?: RowContent | undefined;
};

/** One row of a view's items: its line (`ItemRow`), an action on hover or focus, and its proposals' lines under it. */
export const ItemTreeRow = ({ parts: { treeitem, lead, tabIndex, titleStart, wraps }, node, outside, action, rich = false, content }: ItemTreeRowProps) => (
  <div {...proposalProps(node)} className={cn(REVEALABLE, "group/row relative", rich && "border-b border-line-subtle")}>
    <ItemRow row={node} render={treeitem} lead={lead} wraps={wraps} content={content} />
    {action}
    <ProposalLines row={node} outside={outside} tabIndex={tabIndex} className="pr-2 pb-1" style={{ paddingLeft: titleStart }} />
  </div>
);

const ROW_ACTION = "absolute top-0.5 right-1 bg-surface-1 text-fg-tertiary opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100";

/** A "+" at a row's end, shown on hover or focus within the row (`group/row`); `label` names it and is its tooltip. */
export const RowAction = ({ label, tabIndex, onClick }: { label: string; tabIndex: number; onClick: () => void }) => (
  <Button variant="ghost" size="icon-xs" tabIndex={tabIndex} className={ROW_ACTION} aria-label={label} title={label} onClick={onClick}>
    <Plus />
  </Button>
);
