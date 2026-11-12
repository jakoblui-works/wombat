import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../components/ui/context-menu.tsx";
import { runLogged } from "../commands/registry.ts";
import { commandTitle, SPLIT_DIRECTIONS, splitCommandId, WORKBENCH_COMMAND } from "../commands/workbench-commands.ts";

/** A tab as dockview draws it, with a context menu whose commands act on this tab and its group, not the active ones. */
export const Tab = (props: IDockviewPanelHeaderProps) => {
  // Read when an item is chosen: a tab dragged to another group keeps this component, and its group changes.
  const target = () => ({ groupId: props.api.group.id, panelId: props.api.id });
  return (
    <ContextMenu>
      {/* `contents`: the trigger adds no box of its own, so the tab keeps dockview's layout. */}
      <ContextMenuTrigger className="contents">
        <DockviewDefaultTab {...props} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        {SPLIT_DIRECTIONS.map((direction) => (
          <ContextMenuItem key={direction} onClick={() => runLogged(splitCommandId(direction), target())}>
            {commandTitle(splitCommandId(direction))}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => runLogged(WORKBENCH_COMMAND.closeTab, target())}>Close</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
