import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { cloneElement, useMemo, useState } from "react";

import type { Reveal } from "../../../registry.ts";
import { ItemTree, ItemTreeRow, RowAction } from "../ItemTree/ItemTree.tsx";
import { setClosed } from "../TreeView/tree-view.ts";
import { useOpenRow } from "../use-open-row.ts";
import { isOutsideFilter, itemCount, listGroups, type NewItem, newItemLabel, type Row, shownGroups, viewContext } from "../view-model/view-model.ts";
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
  // Kept in the state, not only applied while the reveal lasts: the reveal ends once its row shows, and the group would fold again.
  const unfolded = unfoldedFor(groups, folded, reveal?.target);
  if (unfolded !== folded) setFolded(unfolded);
  const rows = useMemo(() => listTree(groups, folded), [groups, folded]);
  const toggle = (key: string, open: boolean) => setFolded((current) => setClosed(current, key, open));

  return (
    <ItemTree
      label={view.name}
      rows={rows}
      onToggle={toggle}
      onActivate={({ node, key, expanded }) => (node.kind === "group" ? toggle(key, expanded !== true) : openRow(node.row))}
      reveal={reveal}
      onRevealed={onRevealed}
    >
      {(parts) => {
        const { node } = parts.row;
        if (node.kind === "row") return <ItemTreeRow parts={parts} node={node.row} outside={isOutsideFilter(node.row, view, properties)} />;
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
              <span key="count" className="shrink-0 text-xs text-fg-tertiary tabular-nums">
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
