import { SETTINGS_FILE } from "@wombat/shared/items";
import { ChevronRight, Folder, FolderOpen, Notebook, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo } from "react";

import { cn } from "../../../../lib/utils";
import { type DeskNode, type DeskRow, deskKey, deskRows, nodeName, rowLabel } from "../desk-tree.ts";
import { ProblemList } from "../../../items/ProblemList/ProblemList.tsx";
import { RowAction } from "../RowAction/RowAction.tsx";
import { rowIndent, TREE_ROW, treeChevron } from "../tree-keys.ts";
import { useTreeFocus } from "../use-tree-focus.ts";

type Props = {
  nodes: readonly DeskNode[];
  openDrawers: readonly string[];
  onToggleDrawer: (path: string, open: boolean) => void;
  onOpenBinder: (binderId: string) => void;
  /** Opens New binder in the drawer at this path. */
  onNewBinder: (drawer: string) => void;
  /** A row to focus as soon as it shows (a just-created binder's folder); `onFocused` follows. */
  focusKey?: string | undefined;
  onFocused?: () => void;
};

const RowContent = ({ row }: { row: DeskRow }) => {
  const { node } = row;
  if (node.kind === "drawer") {
    const FolderIcon = row.expanded === true ? FolderOpen : Folder;
    return (
      <span className="flex w-full items-center gap-1.5">
        <ChevronRight aria-hidden className={treeChevron(row.expanded === true)} />
        <FolderIcon aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-fg-secondary">{node.name}</span>
      </span>
    );
  }
  const { binder } = node;
  if (binder.id === null) {
    return (
      <div className="flex w-full flex-col gap-0.5">
        <span className="flex w-full items-center gap-1.5">
          <span aria-hidden className="size-3.5 shrink-0" />
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate text-fg-primary">{nodeName(node)}</span>
        </span>
        <div className="pl-10 select-text">
          <ProblemList problems={binder.problems} file={SETTINGS_FILE} className="text-xs text-danger" />
        </div>
      </div>
    );
  }
  return (
    <span className="flex w-full items-center gap-1.5">
      <span aria-hidden className="size-3.5 shrink-0" />
      <Notebook aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
      <span className="min-w-0 flex-1 truncate font-medium text-fg-primary">{binder.name}</span>
      {binder.invalidCount > 0 ? (
        <span title={`${String(binder.invalidCount)} invalid`} className="flex shrink-0 items-center gap-0.5 text-xs text-danger tabular-nums">
          <TriangleAlert aria-hidden className="size-3" />
          {binder.invalidCount}
        </span>
      ) : null}
      <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{binder.itemCount}</span>
    </span>
  );
};

/** The Desk's tree of drawers and binders (the WAI-ARIA tree pattern, its rows flat with their levels). */
export const DeskTree = ({ nodes, openDrawers, onToggleDrawer, onOpenBinder, onNewBinder, focusKey, onFocused }: Props) => {
  const rows = useMemo(() => deskRows(nodes, new Set(openDrawers)), [nodes, openDrawers]);
  const focus = useTreeFocus(rows.map(({ key }) => key));
  const { focus: focusRow } = focus;

  useEffect(() => {
    if (focusKey === undefined || !rows.some((row) => row.key === focusKey)) return;
    focusRow(focusKey);
    onFocused?.();
  }, [rows, focusKey, focusRow, onFocused]);

  const act = (index: number, key: string, event?: KeyboardEvent) => {
    const action = deskKey(rows, index, key);
    if (action === undefined) return;
    event?.preventDefault();
    if (action.type === "focus") {
      const target = rows[action.index];
      if (target !== undefined) focus.focus(target.key);
    } else if (action.type === "toggle") onToggleDrawer(action.path, action.open);
    else onOpenBinder(action.binderId);
  };

  return (
    <div role="tree" aria-label="Drawers and binders" className="flex flex-col gap-px px-1.5 pt-1 pb-3">
      {rows.map((row, index) => {
        const { node } = row;
        return (
          <div key={row.key} className="group/row relative">
            <div
              ref={focus.register(row.key)}
              role="treeitem"
              aria-level={row.level}
              aria-setsize={row.setSize}
              aria-posinset={row.posInSet}
              aria-expanded={row.expanded}
              aria-label={rowLabel(node)}
              tabIndex={focus.tabIndex(index)}
              onFocus={() => focus.onFocus(row.key)}
              onClick={() => act(index, "Enter")}
              onKeyDown={(event) => act(index, event.key, event)}
              className={cn(
                TREE_ROW,
                "flex py-1",
                node.kind === "binder" && node.binder.id === null && "cursor-auto",
              )}
              style={{ paddingLeft: rowIndent(row.level) }}
            >
              <RowContent row={row} />
            </div>
            {node.kind === "drawer" ? (
              <RowAction label={`New binder in ${node.name}`} tabIndex={focus.tabIndex(index)} onClick={() => onNewBinder(node.path)} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
