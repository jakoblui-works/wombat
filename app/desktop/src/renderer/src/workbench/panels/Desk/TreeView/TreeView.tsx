import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { useMemo } from "react";

import type { Reveal } from "../../../registry.ts";
import type { DeletableItem } from "../../../items/item-delete.ts";
import { itemName } from "../../../items/item-params.ts";
import { rowPreview } from "../ItemPreview/item-preview.ts";
import { ItemTree, ItemTreeRow } from "../ItemTree/ItemTree.tsx";
import { RowAction } from "../RowAction/RowAction.tsx";
import { type OpenRowItem, useOpenRow } from "../use-open-row.ts";
import { useClosedRows, useLastRevealTarget } from "../use-reveal.ts";
import { isOutsideFilter, type NewItem, offersNewChild, type Row, rowItem, treeRows, viewContext } from "../view-model/view-model.ts";
import { ancestorsOf, visibleTreeRows } from "./tree-view.ts";

type Props = {
  rows: readonly Row[];
  view: Extract<LenientView, { kind: "tree" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: OpenRowItem | undefined;
  /** Asks to delete a row's item (`useItemDelete`'s `ask`). */
  onDeleteItem?: ((item: DeletableItem) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

export const TreeView = ({ rows: given, view, properties, onOpenItem, onDeleteItem, onNewItem, reveal, onRevealed }: Props) => {
  const openRow = useOpenRow(onOpenItem);
  const revealed = useLastRevealTarget(reveal);
  const tree = useMemo(() => treeRows(given, view, properties, revealed), [given, view, properties, revealed]);
  const { closed, toggle } = useClosedRows(reveal, (target) => ancestorsOf(tree, target));
  const rows = useMemo(() => visibleTreeRows(tree, closed), [tree, closed]);

  return (
    <ItemTree
      label={view.name}
      rows={rows}
      onToggle={toggle}
      onOpen={({ node }, options) => openRow(node, options)}
      previewOf={({ node }) => rowPreview(node)}
      itemOf={({ node }) => rowItem(node)}
      onDelete={onDeleteItem}
      reveal={reveal}
      onRevealed={onRevealed}
    >
      {(parts) => {
        const { node } = parts.row;
        const action = offersNewChild(node) ? (
          <RowAction label={`New child of ${node.item.handle ?? itemName(node.item)}`} tabIndex={parts.tabIndex} onClick={() => onNewItem(viewContext(view, node))} />
        ) : null;
        return <ItemTreeRow parts={parts} node={node} outside={isOutsideFilter(node, view, properties, revealed)} action={action} />;
      }}
    </ItemTree>
  );
};
