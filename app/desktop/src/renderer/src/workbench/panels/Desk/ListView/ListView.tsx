import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { Plus } from "lucide-react";
import { cloneElement, useMemo, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";
import type { Reveal } from "../../../registry.ts";
import { ItemTree, ItemTreeRow, ROW_ACTION } from "../ItemTree/ItemTree.tsx";
import { setClosed } from "../TreeView/tree-view.ts";
import { useOpenRow } from "../use-open-row.ts";
import { useReveal } from "../use-reveal.ts";
import { isOutsideFilter, itemCount, listGroups, type NewItem, newItemLabel, offersNew, shownGroups, viewContext, type Row } from "../view-model/view-model.ts";
import { listTree, unfoldedFor } from "./list-tree.ts";

type Props = {
  rows: readonly Row[];
  view: Extract<LenientView, { kind: "list" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

/** A binder's list view: its rows in the view's groups and order under headers that fold, the proposed creates its filter hides first. */
export const ListView = ({ rows: given, view, properties, onOpenItem, onNewItem, reveal, onRevealed }: Props) => {
  const openRow = useOpenRow(onOpenItem);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => shownGroups(listGroups(given, view, properties)), [given, view, properties]);
  const unfolded = unfoldedFor(groups, folded, reveal?.target);
  if (unfolded !== folded) setFolded(unfolded);
  const rows = useMemo(() => listTree(groups, folded, reveal?.target), [groups, folded, reveal]);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(reveal, ref, onRevealed);
  const toggle = (key: string, open: boolean) => setFolded((current) => setClosed(current, key, open));

  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>
      ) : (
        <ItemTree
          label={view.name}
          rows={rows}
          onToggle={toggle}
          onActivate={({ node, key, expanded }) => (node.kind === "group" ? toggle(key, expanded !== true) : openRow(node.row))}
        >
          {(parts) => {
            const { node } = parts.row;
            if (node.kind === "row") return <ItemTreeRow parts={parts} node={node.row} outside={isOutsideFilter(node.row, view, properties)} />;
            const { group } = node;
            const name = group.heading;
            return (
              <div className="group/row relative">
                {cloneElement(
                  parts.treeitem,
                  { className: cn(parts.treeitem.props.className, "flex items-center gap-1.5") },
                  parts.lead,
                  <span key="name" className="min-w-0 flex-1 truncate font-medium text-fg-secondary">
                    {name}
                  </span>,
                  <span key="count" className="shrink-0 text-xs text-fg-tertiary tabular-nums">
                    {itemCount(group.rows)}
                  </span>,
                )}
                {offersNew(group) ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    tabIndex={parts.tabIndex}
                    className={ROW_ACTION}
                    aria-label={newItemLabel(name)}
                    title={newItemLabel(name)}
                    onClick={() => onNewItem(viewContext(view, group))}
                  >
                    <Plus />
                  </Button>
                ) : null}
              </div>
            );
          }}
        </ItemTree>
      )}
    </div>
  );
};
