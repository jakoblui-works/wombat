import type { ItemSummary, LenientProperty, LenientView } from "@wombat/shared/items";
import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";

import { cn } from "../../../../lib/utils";
import { ItemRow } from "../ItemRow/ItemRow.tsx";
import { rowIndent, treeKey } from "../tree-keys.ts";
import { useTreeFocus } from "../use-tree-focus.ts";
import { treeRows } from "../view-model/view-model.ts";
import { setClosed, visibleTreeRows } from "./tree-view.ts";

type Props = {
  items: readonly ItemSummary[];
  view: Extract<LenientView, { kind: "tree" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: ((itemId: string) => void) | undefined;
};

export const TreeView = ({ items, view, properties, onOpenItem }: Props) => {
  const [closed, setClosedRows] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => treeRows(items, view, properties), [items, view, properties]);
  const rows = useMemo(() => visibleTreeRows(tree, closed), [tree, closed]);
  const focus = useTreeFocus(rows.map(({ key }) => key));

  const act = (index: number, key: string, event?: KeyboardEvent) => {
    const row = rows[index];
    const action = treeKey(rows, index, key);
    if (row === undefined || action === undefined) return;
    event?.preventDefault();
    if (action.type === "focus") {
      const target = rows[action.index];
      if (target !== undefined) focus.focus(target.key);
    } else if (action.type === "toggle") setClosedRows((current) => setClosed(current, row.key, action.open));
    else if (row.node.item.id !== null) onOpenItem?.(row.node.item.id);
  };

  if (rows.length === 0) return <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>;
  return (
    <div role="tree" aria-label={view.name} className="flex flex-col gap-px px-1.5 pt-1 pb-3">
      {rows.map((row, index) => (
        <ItemRow
          key={row.key}
          item={row.node.item}
          lead={
            <span
              aria-hidden
              className="flex size-3.5 shrink-0 items-center justify-center"
              onClick={(event) => {
                if (row.expanded === undefined) return;
                event.stopPropagation();
                setClosedRows((current) => setClosed(current, row.key, !row.expanded));
              }}
            >
              {row.expanded === undefined ? null : (
                <ChevronRight className={cn("size-3.5 text-fg-tertiary transition-transform", row.expanded && "rotate-90")} />
              )}
            </span>
          }
          render={
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
              className="focus-ring flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 text-left text-base select-none transition-colors hover:bg-surface-2"
              style={{ paddingLeft: rowIndent(row.level) }}
            />
          }
        />
      ))}
    </div>
  );
};
