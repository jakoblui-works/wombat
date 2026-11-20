import { useWorkbench } from "../../workbench-context.ts";
import { isItemRow, type Row } from "./view-model/view-model.ts";
import { opensProposal } from "./view-model/with-proposals.ts";

/** Opens what a click on a row opens: its item, or for a row without one, its proposal (`opensProposal`). */
export const useOpenRow = (onOpenItem: ((itemId: string) => void) | undefined): ((row: Row) => void) => {
  const { openProposal } = useWorkbench();
  return (row) => {
    if (isItemRow(row)) {
      if (row.item.id !== null) onOpenItem?.(row.item.id);
      return;
    }
    const id = opensProposal(row);
    if (id !== undefined) openProposal(id);
  };
};
