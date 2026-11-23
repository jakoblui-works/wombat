import type { Item } from "@wombat/shared/items";
import { Ellipsis } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../../components/ui/dropdown-menu";
import type { SavedItemParams } from "../../../items/item-params.ts";
import { useItemDelete } from "../../../items/use-item-delete.tsx";

/** The item's menu: Delete… deletes the item shown (`useItemDelete`) and closes this tab. */
export const ItemActions = ({ ws, tab, item }: { ws: string; tab: SavedItemParams; item: Item }) => {
  const remove = useItemDelete(ws);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Item actions"
          className="focus-ring flex size-8 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-surface-2 data-popup-open:bg-surface-2"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {/* The tab's own params name the item: the tab closed is this one, also after its file moved to another binder. */}
          <DropdownMenuItem variant="destructive" onClick={() => remove.ask({ ...item, id: tab.itemId, binder: tab.binderId })}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {remove.dialog}
    </>
  );
};
