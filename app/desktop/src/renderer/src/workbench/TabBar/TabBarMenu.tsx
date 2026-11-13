import type { DockviewApi } from "dockview-react";
import { useState, type ReactNode } from "react";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../components/ui/context-menu.tsx";
import { runLogged } from "../commands/registry.ts";
import { commandTitle, SPLIT_DIRECTIONS, splitCommandId, WORKBENCH_COMMAND } from "../commands/workbench-commands.ts";
import { canCloseGroup } from "../tabs.ts";

/** Dockview's class for a group's header: its tabs, the empty strip beside them and its actions. */
const TAB_BAR = ".dv-tabs-and-actions-container";
/** A tab, with the padding dockview puts around the tab's own component (and so around its context menu). */
const TAB = ".dv-tab";

/**
 * The context menu of a group's tab bar outside its tabs (a tab has its own, which keeps the click): the splits, and
 * closing the group while it has no tab. It wraps the editor, since the tab bar's empty strip is dockview's own element.
 */
export const TabBarMenu = ({ api, children }: { api: DockviewApi | undefined; children: ReactNode }) => {
  const [target, setTarget] = useState<{ groupId: string; closable: boolean }>();
  const run = (commandId: string) => {
    if (target !== undefined) runLogged(commandId, { groupId: target.groupId });
  };
  /** Lets the menu open only for a press on a tab bar outside its tabs, and notes that tab bar's group. */
  const aim = (event: { target: EventTarget; preventBaseUIHandler: () => void }) => {
    const pressed = event.target instanceof Element ? event.target : null;
    const onTabBar = pressed?.closest(TAB_BAR) != null && pressed.closest(TAB) === null;
    const group = onTabBar ? api?.groups.find(({ element }) => element.contains(pressed)) : undefined;
    if (api === undefined || group === undefined) {
      event.preventBaseUIHandler();
      return;
    }
    setTarget({ groupId: group.id, closable: canCloseGroup(api, group.id) });
  };
  return (
    <ContextMenu>
      {/* The trigger also opens on a long touch, which sends no contextmenu event. */}
      <ContextMenuTrigger className="contents" onContextMenu={aim} onTouchStart={aim}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {SPLIT_DIRECTIONS.map((direction) => (
          <ContextMenuItem key={direction} onClick={() => run(splitCommandId(direction))}>
            {commandTitle(splitCommandId(direction))}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={target?.closable !== true} onClick={() => run(WORKBENCH_COMMAND.closeGroup)}>
          {commandTitle(WORKBENCH_COMMAND.closeGroup)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
