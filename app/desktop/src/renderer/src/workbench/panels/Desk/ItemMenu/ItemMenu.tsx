import type { ReactElement } from "react";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../../../components/ui/context-menu";
import { runLogged } from "../../../commands/registry.ts";
import { DESK_COMMAND } from "../desk-commands.ts";

/**
 * An item row's context menu, on `children` (the row's box, which takes the trigger's props): Open (kept) and Delete… run
 * the Desk's commands on the row's element (`row`, read when chosen).
 */
export const ItemMenu = ({ row, children }: { row: () => Element | undefined; children: ReactElement }) => {
  const run = (id: string, keep = false) => {
    const element = row();
    if (element !== undefined) runLogged(id, { element, keep });
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => run(DESK_COMMAND.open, true)}>Open</ContextMenuItem>
        <ContextMenuItem className="text-danger" onClick={() => run(DESK_COMMAND.delete)}>
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
