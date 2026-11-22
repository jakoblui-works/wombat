import { type ReactNode, useState } from "react";

import { useDeleteItem } from "../../../data/commands.ts";
import { writeFailure } from "../../../data/write-failure.ts";
import { lastPathPart } from "../../../lib/path.ts";
import { closeGuards, tabKey } from "../../tabs.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { DeleteItemDialog } from "./DeleteItemDialog/DeleteItemDialog.tsx";
import { asked, closed, confirmable, type DeletableItem, type DeleteQuestion, refused, sending } from "./item-delete.ts";
import { itemTitle } from "./item-params.ts";

/**
 * Deletes an item from the UI: `ask` opens the question (`dialog`, to be rendered by the caller), and Delete there
 * deletes the file at the version `ask` was given, then closes the item's tabs, whichever binder they were opened
 * from, unsaved edits and all (the question says so). A stale version deletes nothing and the question says the file changed.
 */
export const useItemDelete = (): { ask: (item: DeletableItem) => void; dialog: ReactNode } => {
  const remove = useDeleteItem();
  const { closeTab, itemTabs } = useWorkbench();
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
          for (const tab of itemTabs(item.id)) closeTab(tab.panelId, tab.params);
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

  const unsaved = (item: DeletableItem) => itemTabs(item.id).some((tab) => closeGuards().unsaved(tabKey(tab.panelId, tab.params)));
  return { ask: (item) => setQuestion(asked(item, unsaved(item))), dialog };
};
