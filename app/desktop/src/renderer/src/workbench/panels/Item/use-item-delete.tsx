import { type ReactNode, useState } from "react";

import { useDeleteItem } from "../../../data/commands.ts";
import { writeFailure } from "../../../data/write-failure.ts";
import { lastPathPart } from "../../../lib/path.ts";
import { closeGuards, tabKey } from "../../tabs.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { DeleteItemDialog } from "./DeleteItemDialog/DeleteItemDialog.tsx";
import { asked, closed, confirmable, type DeletableItem, type DeleteQuestion, refused, sending } from "./item-delete.ts";
import { ITEM_PANEL, itemTitle, type SavedItemParams } from "./item-params.ts";

/** The params of item `item`'s tab, opened from `item.binder`. */
const tabParams = (item: DeletableItem): SavedItemParams => ({ binderId: item.binder, itemId: item.id });

/**
 * Deletes an item from the UI: `ask` opens the question (`dialog`, to be rendered by the caller), and Delete there
 * deletes the file at the version `ask` was given, then closes the item's tab opened from `item.binder`, unsaved edits
 * and all (the question says so). A stale version deletes nothing and the question says the file changed.
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
          closeTab(ITEM_PANEL, tabParams(item));
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
        unsaved={question.unsaved}
        onCancel={() => setQuestion(closed)}
        onDelete={confirm}
      />
    );

  return { ask: (item) => setQuestion(asked(item, closeGuards().unsaved(tabKey(ITEM_PANEL, tabParams(item))))), dialog };
};
