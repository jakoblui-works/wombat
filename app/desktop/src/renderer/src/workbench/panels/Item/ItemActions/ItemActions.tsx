import type { Item, Problem } from "@wombat/shared/items";
import { Ellipsis } from "lucide-react";
import { useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../../components/ui/dropdown-menu";
import { useDeleteItem } from "../../../../data/commands.ts";
import { writeFailure } from "../../../../data/write-failure.ts";
import { lastPathPart } from "../../../../lib/path.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { DeleteItemDialog } from "../DeleteItemDialog/DeleteItemDialog.tsx";
import { ITEM_PANEL, itemTitle, type SavedItemParams } from "../item-params.ts";

/**
 * The item's menu: Delete asks once, then deletes the file at the version shown when it asked. A stale delete deletes
 * nothing and says the file changed; a delete closes the tab.
 */
export const ItemActions = ({ tab, item, onStale }: { tab: SavedItemParams; item: Item; onStale: (stale: boolean) => void }) => {
  const remove = useDeleteItem();
  const { closeTab } = useWorkbench();
  const [asked, setAsked] = useState<{ version: string } | undefined>();
  const [problems, setProblems] = useState<readonly Problem[]>([]);

  const confirm = () => {
    if (asked === undefined) return;
    setProblems([]);
    remove.mutate(
      { ref: tab.itemId, version: asked.version },
      {
        onSuccess: () => {
          setAsked(undefined);
          closeTab(ITEM_PANEL, tab);
        },
        onError: (failure) => {
          const outcome = writeFailure(failure);
          if (outcome !== "stale") {
            setProblems(outcome);
            return;
          }
          setAsked(undefined);
          onStale(true);
        },
      },
    );
  };

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
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setProblems([]);
              onStale(false);
              setAsked({ version: item.version });
            }}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteItemDialog
        name={itemTitle(item)}
        file={lastPathPart(item.path)}
        open={asked !== undefined}
        pending={remove.isPending}
        problems={problems}
        onCancel={() => setAsked(undefined)}
        onDelete={confirm}
      />
    </>
  );
};
