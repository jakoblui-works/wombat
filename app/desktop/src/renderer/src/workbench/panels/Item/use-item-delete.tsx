import { type ReactNode, useState } from "react";

import { useDeleteItem } from "../../../data/commands.ts";
import { writeFailure } from "../../../data/write-failure.ts";
import { lastPathPart } from "../../../lib/path.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { DeleteItemDialog } from "./DeleteItemDialog/DeleteItemDialog.tsx";
import { asked, closed, confirmable, type DeletableItem, type DeleteQuestion, refused, sending } from "./item-delete.ts";
import { ITEM_PANEL, itemTitle, type SavedItemParams } from "./item-params.ts";

/**
 * Deletes an item from the UI: `ask` opens the question (`dialog`, to be rendered by the caller), and Delete there
 * deletes the file at the version `ask` was given, then closes the item's tab opened from `item.binder`. A stale
 * version deletes nothing and the question says the file changed.
 */
export const useItemDelete = (): { ask: (item: DeletableItem) => void; dialog: ReactNode } => {
  const remove = useDeleteItem();
  const { closeTab } = useWorkbench();
  const [question, setQuestion] = useState<DeleteQuestion>();

  const confirm = () => {
    if (!confirmable(question, remove.isPending) || question === undefined) return;
    const { item } = question;
    setQuestion(sending);
    remove.mutate(
      { ref: item.id, version: item.version },
      {
        onSuccess: () => {
          setQuestion(closed);
          closeTab(ITEM_PANEL, { binderId: item.binder, itemId: item.id } satisfies SavedItemParams);
        },
        onError: (failure) => setQuestion((current) => refused(current, writeFailure(failure))),
      },
    );
  };

  const dialog =
    question === undefined ? null : (
      <DeleteItemDialog
        name={itemTitle(question.item)}
        file={lastPathPart(question.item.path)}
        open={question.open}
        disabled={!confirmable(question, remove.isPending)}
        problems={question.problems}
        onCancel={() => setQuestion(closed)}
        onDelete={confirm}
      />
    );

  return { ask: (item) => setQuestion(asked(item)), dialog };
};
