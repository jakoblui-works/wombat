// A board view's columns and cards, pure.
import type { ItemSummary, LenientProperty, LenientView } from "@wombat/shared/items";

import { clearable, displayValue, valueRank } from "../Desk/view-model/values.ts";
import { outsideFilter, type Row, rowValue, sorted, visibleItems } from "../Desk/view-model/view-model.ts";

type Properties = Readonly<Record<string, LenientProperty>>;

export type BoardView = Extract<LenientView, { kind: "board" }>;

/** `value`: an option of the view's column property, as items hold it; `none`: the items without one of its options. */
export type Column = { key: string; rows: Row[] } & ({ kind: "value"; value: unknown } | { kind: "none" });

/** The heading of the column for the items without a value. */
export const NO_VALUE = "No value";

const NONE_KEY = "none";

const optionsOf = (property: LenientProperty | undefined): readonly string[] => (property?.type === "select" ? property.options : []);

/**
 * The view's visible rows, sorted, in one column per option of its column property in option order (empty ones too),
 * after a first column for the rows without a value (`valueRank`) when there are any. A proposed create the view's
 * filter would hide goes first in its column.
 */
export const boardColumns = (rows: readonly Row[], view: BoardView, properties: Properties): Column[] => {
  const property = properties[view.column];
  const columns: Extract<Column, { kind: "value" }>[] = optionsOf(property).map((option) => ({ key: `value:${option}`, kind: "value", value: option, rows: [] }));
  const none: Row[] = [];
  for (const row of [...sorted(outsideFilter(rows, view, properties), view, properties), ...sorted(visibleItems(rows, view, properties), view, properties)]) {
    const rank = valueRank(property, rowValue(row, view.column, properties));
    const column = typeof rank === "number" ? columns[rank] : undefined;
    if (column === undefined) none.push(row);
    else column.rows.push(row);
  }
  return none.length > 0 ? [{ key: NONE_KEY, kind: "none", rows: none }, ...columns] : columns;
};

export const columnLabel = (column: Column, view: BoardView, properties: Properties): string =>
  column.kind === "none" ? NO_VALUE : displayValue(properties[view.column], column.value);

/**
 * A drop the items may not show yet: the item at `path`, written on `version`, in the column holding `value` (null: no
 * value); `answered`, the version its save answered, once it succeeded.
 */
export type Move = { path: string; value: unknown; version: string; answered?: string };

/**
 * The moves still to show: those under way, and saved ones until the items hold the version their save answered or a
 * version none of the moves of that file knows (a write from elsewhere).
 */
export const liveMoves = (moves: readonly Move[], items: readonly ItemSummary[]): Move[] =>
  moves.filter((move) => {
    if (move.answered === undefined) return true;
    const read = items.find(({ path }) => path === move.path)?.version;
    const known = moves.some((other) => other.path === move.path && (other.version === read || other.answered === read));
    return read !== undefined && read !== move.answered && known;
  });

/** The version a write of `item` names: the one its newest saved move answered while that move shows, else as read. */
export const versionToSend = (item: Pick<ItemSummary, "path" | "version">, moves: readonly Move[]): string =>
  moves.findLast((move) => move.path === item.path && move.answered !== undefined)?.answered ?? item.version;

/** The items with each move applied to the view's column property (a null value removes it); moved items are copies. */
export const withMoves = (items: readonly ItemSummary[], view: BoardView, moves: readonly Move[]): ItemSummary[] => {
  if (moves.length === 0) return [...items];
  return items.map((item) => {
    const move = moves.findLast(({ path }) => path === item.path);
    if (move === undefined) return item;
    const rest = Object.fromEntries(Object.entries(item.properties).filter(([name]) => name !== view.column));
    return { ...item, properties: move.value === null ? rest : { ...rest, [view.column]: move.value } };
  });
};

export const columnValue = (column: Column): unknown => (column.kind === "value" ? column.value : null);

/** What a drop of the item at `path`, to be written on `version`, from column `from` onto column `to` does. */
export type DropOutcome = { kind: "stay" } | { kind: "required"; property: string } | { kind: "save"; fields: Record<string, unknown>; move: Move };

/** Nothing for a drop in its own column, nothing (and why) for a required property's No value, else the field to write. */
export const dropOutcome = (item: { path: string; version: string }, from: Column, to: Column, view: BoardView, properties: Properties): DropOutcome => {
  if (from.key === to.key) return { kind: "stay" };
  const property = properties[view.column];
  if (to.kind === "none" && property !== undefined && !clearable(property)) return { kind: "required", property: view.column };
  const value = columnValue(to);
  return { kind: "save", fields: { [view.column]: value }, move: { path: item.path, value, version: item.version } };
};
