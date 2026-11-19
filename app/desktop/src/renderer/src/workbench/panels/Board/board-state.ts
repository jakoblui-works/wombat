// What a board tab shows, from the binders and the binder's items, pure.
import type { BinderSummary, ItemSummary } from "@wombat/shared/items";

import { type Binder, binderOf, type NoBinder, type Read, unshown, usable } from "../Item/item-state.ts";
import type { BoardView } from "./board-columns.ts";

export type BoardShown =
  | { kind: "loading" }
  | { kind: "error"; what: "binders" | "binder-items"; message: string }
  | NoBinder
  /** The binder has no board view of the tab's name. */
  | { kind: "no-view"; binder: Binder }
  | { kind: "board"; binder: Binder; view: BoardView; items: readonly ItemSummary[] };

/** The board while its binder has a board view named `viewName`, else why not; the binders decide first. */
export const boardShown = (binderId: string, viewName: string, binders: Read<readonly BinderSummary[]>, items: Read<readonly ItemSummary[]>): BoardShown => {
  const listed = usable(binders);
  if (listed === undefined) {
    const message = unshown(binders);
    return message === undefined ? { kind: "loading" } : { kind: "error", what: "binders", message };
  }
  const found = binderOf(binderId, listed);
  if (found.kind !== "binder") return found;
  const { binder } = found;
  const view = binder.views.find((each): each is BoardView => each.kind === "board" && each.name === viewName);
  if (view === undefined) return { kind: "no-view", binder };
  const shown = usable(items);
  if (shown === undefined) {
    const message = unshown(items);
    return message === undefined ? { kind: "loading" } : { kind: "error", what: "binder-items", message };
  }
  return { kind: "board", binder, view, items: shown };
};
