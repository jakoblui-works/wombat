import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import type { Reveal } from "../../../registry.ts";
import { itemName } from "../../Item/item-params.ts";
import { ItemTree, ItemTreeRow, ROW_ACTION } from "../ItemTree/ItemTree.tsx";
import { useOpenRow } from "../use-open-row.ts";
import { useReveal } from "../use-reveal.ts";
import { isItemRow, isOutsideFilter, type NewItem, type Row, treeRows, viewContext } from "../view-model/view-model.ts";
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

export const TreeView = ({ rows: given, view, properties, onOpenItem, onNewItem, reveal, onRevealed }: Props) => {
  const openRow = useOpenRow(onOpenItem);
  const [closed, setClosedRows] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => treeRows(given, view, properties), [given, view, properties]);
  const [openedFor, setOpenedFor] = useState<Reveal>();
  const above = reveal === undefined || reveal === openedFor ? undefined : ancestorsOf(tree, reveal.target);
  if (above !== undefined) {
    setOpenedFor(reveal);
    setClosedRows((current) => opened(current, above));
  }
  const rows = useMemo(() => visibleTreeRows(tree, closed), [tree, closed]);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(reveal, ref, onRevealed);

  return (
    <div ref={ref}>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>
      ) : (
        <ItemTree
          label={view.name}
          rows={rows}
          onToggle={(key, open) => setClosedRows((current) => setClosed(current, key, open))}
          onActivate={({ node }) => openRow(node)}
        >
          {(parts) => {
            const { node } = parts.row;
            const name = isItemRow(node) && node.item.id !== null ? (node.item.handle ?? itemName(node.item)) : undefined;
            const action =
              !isItemRow(node) || name === undefined ? null : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  tabIndex={parts.tabIndex}
                  className={ROW_ACTION}
                  aria-label={`New child of ${name}`}
                  title={`New child of ${name}`}
                  onClick={() => onNewItem(viewContext(view, node))}
                >
                  <Plus />
                </Button>
              );
            return <ItemTreeRow parts={parts} node={node} outside={isOutsideFilter(node, view, properties)} action={action} />;
          }}
        </ItemTree>
      )}
    </div>
  );
};
