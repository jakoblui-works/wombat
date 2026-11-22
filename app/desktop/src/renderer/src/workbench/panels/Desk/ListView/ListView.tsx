import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { cloneElement, useMemo } from "react";

import { cn } from "../../../../lib/utils";
import type { Reveal } from "../../../registry.ts";
import type { DeletableItem } from "../../Item/item-delete.ts";
import { rowPreview } from "../ItemPreview/item-preview.ts";
import { ItemTree, ItemTreeRow } from "../ItemTree/ItemTree.tsx";
import { RowAction } from "../RowAction/RowAction.tsx";
import { FIRST_LINE } from "../tree-keys.ts";
import { useClosedRows, useLastRevealTarget } from "../use-reveal.ts";
import { type OpenRowItem, useOpenRow } from "../use-open-row.ts";
import { richRows, rowContent } from "../view-model/row-content.ts";
import { isItemRow, isOutsideFilter, itemCount, listGroups, type NewItem, newItemLabel, type Row, rowItem, shownGroups, viewContext } from "../view-model/view-model.ts";
import { listAncestorsOf, listTree } from "./list-tree.ts";

type Props = {
  rows: readonly Row[];
  view: Extract<LenientView, { kind: "list" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: OpenRowItem | undefined;
  /** Asks to delete a row's item (`useItemDelete`'s `ask`). */
  onDeleteItem?: ((item: DeletableItem) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

/**
 * A binder's list view: its rows in the view's groups and order under headers that fold, the proposed creates its filter
 * hides first; each row's title wrapped in full, or its paragraph in the title's place when the rows are rich (`richRows`).
 */
export const ListView = ({ rows: given, view, properties, onOpenItem, onDeleteItem, onNewItem, reveal, onRevealed }: Props) => {
  const openRow = useOpenRow(onOpenItem);
  const revealed = useLastRevealTarget(reveal);
  const groups = useMemo(() => shownGroups(listGroups(given, view, properties, revealed)), [given, view, properties, revealed]);
  const { closed: folded, toggle } = useClosedRows(reveal, (target) => listAncestorsOf(groups, target));
  const rows = useMemo(() => listTree(groups, folded), [groups, folded]);
  const rich = richRows(view);

  return (
    <ItemTree
      label={view.name}
      rows={rows}
      onToggle={toggle}
      onOpen={({ node, key, expanded }, options) => {
        if (node.kind === "row") openRow(node.row, options);
        // A double click's kept open isn't a third toggle: its two clicks already folded and unfolded the header.
        else if (options.temporary === true) toggle(key, expanded !== true);
      }}
      previewOf={({ node }) => (node.kind === "row" ? rowPreview(node.row) : undefined)}
      itemOf={({ node }) => (node.kind === "row" ? rowItem(node.row) : undefined)}
      onDelete={onDeleteItem}
      reveal={reveal}
      onRevealed={onRevealed}
      wraps
    >
      {(parts) => {
        const { node } = parts.row;
        if (node.kind === "row") {
          const { row } = node;
          const content = isItemRow(row) ? rowContent(row.item, view) : undefined;
          return <ItemTreeRow parts={parts} node={row} outside={isOutsideFilter(row, view, properties, revealed)} rich={rich} content={content} />;
        }
        const { group } = node;
        return (
          <div className="group/row relative">
            {cloneElement(
              parts.treeitem,
              {},
              parts.lead,
              <span key="name" className="min-w-0 flex-1 truncate font-medium text-fg-secondary">
                {group.heading}
              </span>,
              <span key="count" className={cn("shrink-0 text-xs text-fg-tertiary tabular-nums", FIRST_LINE)}>
                {itemCount(group.rows)}
              </span>,
            )}
            <RowAction label={newItemLabel(group.heading)} tabIndex={parts.tabIndex} onClick={() => onNewItem(viewContext(view, group))} />
          </div>
        );
      }}
    </ItemTree>
  );
};
