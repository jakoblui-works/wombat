import { type OpenOptions, useWorkbench } from "../../workbench-context.ts";
import { isItemRow, type Row, rowItemId } from "./view-model/view-model.ts";
import { opensProposal } from "./view-model/with-proposals.ts";

/** Opens a binder's item by id from one of its rows. */
export type OpenRowItem = (itemId: string, options: OpenOptions) => void;

/**
 * Opens what a click on a row opens: its item (in a temporary tab or kept, as `options` says), or for a row without
 * one, its proposal (`opensProposal`).
 */
export const useOpenRow = (onOpenItem: OpenRowItem | undefined): ((row: Row, options: OpenOptions) => void) => {
  const { openProposal } = useWorkbench();
  return (row, options) => {
    if (isItemRow(row)) {
      const itemId = rowItemId(row);
      if (itemId !== undefined) onOpenItem?.(itemId, options);
      return;
    }
    const id = opensProposal(row);
    if (id !== undefined) openProposal(id);
  };
};
