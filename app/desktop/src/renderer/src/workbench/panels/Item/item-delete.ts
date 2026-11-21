// Deleting an item from the UI, pure: the question asked once before the delete, and what a refused delete leaves.
import type { ItemSummary, Problem } from "@wombat/shared/items";

/** An item a delete names: its id, and the version shown when the delete was asked; `binder` and `id` name its tab. */
export type DeletableItem = Pick<ItemSummary, "handle" | "title" | "path" | "version" | "binder"> & { id: string };

/**
 * The question asked before a delete; kept while it closes, so its text stays for the fade. `unsaved`: the item's tab
 * held unsaved edits when it was asked, which the delete loses.
 */
export type DeleteQuestion = { item: DeletableItem; open: boolean; problems: readonly Problem[]; stale: boolean; unsaved: boolean };

export const STALE_DELETE = "This item's file changed since you asked to delete it, so nothing was deleted. Look at the item again, then delete it if you still want to.";

export const asked = (item: DeletableItem, unsaved: boolean): DeleteQuestion => ({ item, open: true, problems: [], stale: false, unsaved });

export const closed = (question: DeleteQuestion | undefined): DeleteQuestion | undefined => question && { ...question, open: false };

/** A delete sent from the open question: the last refusal's problems go. */
export const sending = (question: DeleteQuestion | undefined): DeleteQuestion | undefined => question && { ...question, problems: [] };

/** A refused delete, while its question is still open: a stale one says the file changed and can't be confirmed again. */
export const refused = (question: DeleteQuestion | undefined, failure: "stale" | Problem[]): DeleteQuestion | undefined => {
  if (question?.open !== true) return question;
  return failure === "stale" ? { ...question, stale: true, problems: [{ message: STALE_DELETE }] } : { ...question, problems: failure };
};

/** Whether the question's Delete can be pressed: not while a delete is on its way, and not after a stale one. */
export const confirmable = (question: DeleteQuestion | undefined, pending: boolean): boolean => question?.open === true && !question.stale && !pending;
