import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { useMemo, useState } from "react";

import type { Reveal } from "../../../registry.ts";
import { itemName } from "../../Item/item-params.ts";
import { rowPreview } from "../ItemPreview/item-preview.ts";
import { ItemTree, ItemTreeRow, RowAction } from "../ItemTree/ItemTree.tsx";
import { useOpenRow } from "../use-open-row.ts";
import { isOutsideFilter, type NewItem, offersNewChild, type Row, treeRows, viewContext } from "../view-model/view-model.ts";
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

  return (
    <ItemTree
      label={view.name}
      rows={rows}
      onToggle={(key, open) => setClosedRows((current) => setClosed(current, key, open))}
      onActivate={({ node }) => openRow(node)}
      onOpen={({ node }) => openRow(node)}
      previewOf={({ node }) => rowPreview(node)}
      reveal={reveal}
      onRevealed={onRevealed}
    >
      {(parts) => {
        const { node } = parts.row;
        const action = offersNewChild(node) ? (
          <RowAction label={`New child of ${node.item.handle ?? itemName(node.item)}`} tabIndex={parts.tabIndex} onClick={() => onNewItem(viewContext(view, node))} />
        ) : null;
        return <ItemTreeRow parts={parts} node={node} outside={isOutsideFilter(node, view, properties)} action={action} />;
      }}
    </ItemTree>
  );
};
