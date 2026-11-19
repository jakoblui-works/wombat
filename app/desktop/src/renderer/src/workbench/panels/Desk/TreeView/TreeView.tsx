import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { ChevronRight, Plus } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";
import type { Reveal } from "../../../registry.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { itemName } from "../../Item/item-params.ts";
import { ItemRow, PendingItemRow } from "../ItemRow/ItemRow.tsx";
import { ProposalLine } from "../ProposalLine/ProposalLine.tsx";
import { rowIndent, treeKey } from "../tree-keys.ts";
import { proposalProps, REVEALABLE, useReveal } from "../use-reveal.ts";
import { useTreeFocus } from "../use-tree-focus.ts";
import { isOutsideFilter, isPending, type NewItem, type Row, proposedTitle, treeRows, viewContext } from "../view-model/view-model.ts";
import { ancestorsOf, opened, setClosed, visibleTreeRows } from "./tree-view.ts";

type Props = {
  rows: readonly Row[];
  view: Extract<LenientView, { kind: "tree" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

/** The chevron's width and the gap after it, in pixels: where a row's handle starts past its indent. */
const LEAD_PX = 14 + 6;

export const TreeView = ({ rows: given, view, properties, onOpenItem, onNewItem, reveal, onRevealed }: Props) => {
  const { openProposal } = useWorkbench();
  const [closed, setClosedRows] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => treeRows(given, view, properties), [given, view, properties]);
  const [openedFor, setOpenedFor] = useState<Reveal>();
  const above = reveal === undefined || reveal === openedFor ? undefined : ancestorsOf(tree, reveal.target);
  if (above !== undefined) {
    setOpenedFor(reveal);
    setClosedRows((current) => opened(current, above));
  }
  const rows = useMemo(() => visibleTreeRows(tree, closed), [tree, closed]);
  const focus = useTreeFocus(rows.map(({ key }) => key));
  const ref = useRef<HTMLDivElement>(null);
  useReveal(reveal, ref, onRevealed);

  const act = (index: number, key: string, event?: KeyboardEvent) => {
    const row = rows[index];
    const action = treeKey(rows, index, key);
    if (row === undefined || action === undefined) return;
    event?.preventDefault();
    if (action.type === "focus") {
      const target = rows[action.index];
      if (target !== undefined) focus.focus(target.key);
    } else if (action.type === "toggle") setClosedRows((current) => setClosed(current, row.key, action.open));
    else if (isPending(row.node)) openProposal(row.node.pending.id);
    else if (row.node.item.id !== null) onOpenItem?.(row.node.item.id);
  };

  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>
      ) : (
        <div role="tree" aria-label={view.name} className="flex flex-col gap-px px-1.5 pt-1 pb-3">
          {rows.map((row, index) => {
            const { node } = row;
            const lead = (
              <span
                aria-hidden
                className="flex size-3.5 shrink-0 items-center justify-center"
                onClick={(event) => {
                  if (row.expanded === undefined) return;
                  event.stopPropagation();
                  setClosedRows((current) => setClosed(current, row.key, !row.expanded));
                }}
              >
                {row.expanded === undefined ? null : <ChevronRight className={cn("size-3.5 text-fg-tertiary transition-transform", row.expanded && "rotate-90")} />}
              </span>
            );
            const render = (
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
                className="focus-ring flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base transition-colors select-none hover:bg-surface-2"
                style={{ paddingLeft: rowIndent(row.level) }}
              />
            );
            return (
              <div key={row.key} {...proposalProps(node)} className={REVEALABLE}>
                <div className="group/row relative">
                  {isPending(node) ? (
                    <PendingItemRow title={proposedTitle(node)} lead={lead} render={render} />
                  ) : (
                    <ItemRow item={node.item} struck={node.proposal?.kind === "delete"} lead={lead} render={render} />
                  )}
                  {isPending(node) || node.item.id === null ? null : (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      tabIndex={focus.tabIndex(index)}
                      className="absolute inset-y-0 right-1 my-auto bg-surface-1 text-fg-tertiary opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
                      aria-label={`New child of ${node.item.handle ?? itemName(node.item)}`}
                      title={`New child of ${node.item.handle ?? itemName(node.item)}`}
                      onClick={() => onNewItem(viewContext(view, node))}
                    >
                      <Plus />
                    </Button>
                  )}
                </div>
                <ProposalLine
                  row={node}
                  outside={isOutsideFilter(node, view, properties)}
                  tabIndex={focus.tabIndex(index)}
                  className="pr-2 pb-1"
                  style={{ paddingLeft: rowIndent(row.level) + LEAD_PX }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
