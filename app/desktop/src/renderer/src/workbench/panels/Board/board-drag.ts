// A card held on the board, by mouse or keyboard, and what each column shows meanwhile, pure.
import type { ItemSummary } from "@wombat/shared/items";

import type { Column } from "./board-columns.ts";

/** A card can be picked up only when its item has an id to write it by (its file parses). */
export const canMove = (item: Pick<ItemSummary, "id">): boolean => item.id !== null;

/** The card at path `id`, picked up in column `from` and now over column `over` (column keys). */
export type Held = { id: string; from: string; over: string; byMouse: boolean; dropped: boolean };

export type DragEvent =
  | { type: "pick"; id: string; from: string; byMouse: boolean }
  /** The mouse over a column. */
  | { type: "over"; column: string }
  /** The mouse over no column: the card shows back home, and a release there drops nothing. */
  | { type: "outside" }
  /** The board's cards now: a hold ends once its card is no longer in its home column. */
  | { type: "cards"; columns: readonly Column[] }
  /** The card at `id` lost focus: a keyboard hold of it ends. */
  | { type: "blur"; id: string }
  /** An arrow key: one column left or right of `over` among `columns`, nothing past the ends. */
  | { type: "step"; by: -1 | 1; columns: readonly string[] }
  /** A drop on a column (the mouse); the drag's end then commits it. */
  | { type: "drop" }
  | { type: "end" };

export const drag = (held: Held | undefined, event: DragEvent): Held | undefined => {
  switch (event.type) {
    case "pick":
      return { id: event.id, from: event.from, over: event.from, byMouse: event.byMouse, dropped: false };
    case "end":
      return undefined;
    case "over":
      return held?.byMouse === true && held.over !== event.column ? { ...held, over: event.column } : held;
    case "outside":
      return held?.byMouse === true && held.over !== held.from ? { ...held, over: held.from } : held;
    case "cards": {
      const home = event.columns.find(({ key }) => key === held?.from);
      return held === undefined || home?.rows.some(({ item }) => item.path === held.id) === true ? held : undefined;
    }
    case "blur":
      return held !== undefined && !held.byMouse && held.id === event.id ? undefined : held;
    case "step": {
      if (held === undefined || held.byMouse) return held;
      const at = event.columns.indexOf(held.over) + event.by;
      const over = event.columns[at];
      return at < 0 || over === undefined ? held : { ...held, over };
    }
    case "drop":
      return held?.byMouse === true ? { ...held, dropped: true } : held;
  }
};

/**
 * How a card renders: as itself; `hidden`, the mouse-held card's own node, which stays mounted in its home column
 * because the browser ends the drag on it; `preview`, a plain copy where the mouse holds it; `held`, the picked-up card
 * itself, highlighted (by keyboard it moves with `over`).
 */
export type CardMode = "card" | "hidden" | "preview" | "held";

export type ShownCard = { row: Column["rows"][number]; mode: CardMode };

/**
 * The cards column `key` shows: the board as it stands (`base`), or, where the held card is over another column, as
 * it would be after the drop (`preview`): in the column it is over, and, by keyboard, everywhere.
 */
export const shownCards = (key: string, base: readonly Column[], preview: readonly Column[], held: Held | undefined): ShownCard[] => {
  const rowsIn = (columns: readonly Column[]) => columns.find((column) => column.key === key)?.rows ?? [];
  const modeOf = (path: string, mode: CardMode): CardMode => (path === held?.id ? mode : "card");
  if (held === undefined || held.over === held.from) return rowsIn(base).map((row) => ({ row, mode: modeOf(row.item.path, "held") }));
  if (!held.byMouse) return rowsIn(preview).map((row) => ({ row, mode: modeOf(row.item.path, "held") }));
  if (key === held.over) return rowsIn(preview).map((row) => ({ row, mode: modeOf(row.item.path, "preview") }));
  return rowsIn(base).map((row) => ({ row, mode: modeOf(row.item.path, "hidden") }));
};

export const pickedUp = (title: string, column: string): string =>
  `Picked up ${title} in ${column}. Left and right arrows move it between columns, Space drops it, Escape cancels.`;
export const heldOver = (title: string, column: string): string => `${title} over ${column}.`;
export const droppedIn = (title: string, column: string): string => `${title} dropped in ${column}.`;
export const putBack = (title: string, column: string): string => `${title} put back in ${column}.`;

/** What a keyboard drop announces: dropped where it went (or stayed by choice), else put back home. */
export const dropSentence = (result: "moved" | "stayed", drop: Held, title: string, labelOf: (key: string) => string): string =>
  result === "moved" || drop.over === drop.from ? droppedIn(title, labelOf(drop.over)) : putBack(title, labelOf(drop.from));

/** A column is highlighted while the mouse holds a card over it, away from the card's home. */
export const highlighted = (key: string, held: Held | undefined): boolean => held?.byMouse === true && held.over === key && held.over !== held.from;

/** The card that takes focus as it renders: the one held by keyboard, else the one a keyboard hold last ended on. */
export const takesFocus = (path: string, mode: CardMode, held: Held | undefined, endedOn: string | undefined): boolean =>
  mode === "held" ? held?.byMouse === false : held === undefined && path === endedOn;

/** A press of the pointer on the board while a card is held by keyboard only ends the hold: it opens nothing. */
export const pressOnlyEndsHold = (held: Held | undefined): boolean => held !== undefined && !held.byMouse;
