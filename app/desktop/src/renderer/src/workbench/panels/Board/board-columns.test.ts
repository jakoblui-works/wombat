// A board view's columns: every card its view shows lands in exactly one column, the one its value names (No value
// for a missing or unknown value), in the order the list views use. And a drop the items don't show yet: shown until
// the items catch up with its save or are written from elsewhere, and a drop meanwhile names the version that save
// answered, so the next write isn't refused as stale.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { isItemRow, type Row, sorted, visibleItems } from "../Desk/view-model/view-model.ts";
import { boardColumns, type BoardView, liveMoves, type Move, versionToSend } from "./board-columns.ts";

type Properties = Record<string, LenientProperty>;

// ---- Invented items ----

const idOf = (n: number): string => `0196f3c2-6e00-7000-8000-${n.toString(16).padStart(12, "0")}`;

/** The items as the rows the board takes, none of them pending. */
const rowsOf = (items: readonly ItemSummary[]): Row[] => items.map((one) => ({ item: one }));
const itemOf = (row: Row): ItemSummary => {
  if (!isItemRow(row)) throw new Error(`a row without an item where only items were given: ${JSON.stringify(row)}`);
  return row.item;
};

const item = (n: number, properties: Record<string, unknown> = {}, version = "0".repeat(64)): ItemSummary => ({
  id: idOf(n),
  handle: `OPS-${String(n)}`,
  aliases: [],
  title: `Invented card ${String(n)}`,
  properties,
  path: `ops/OPS-${String(n)}-card.md`,
  version,
  problems: [],
  excerpt: null,
  binder: "ops",
});

const handles = (items: readonly ItemSummary[]): (string | null)[] => items.map((one) => one.handle);

// ---- Generated binders and views ----

const OPTIONS = ["queued", "active", "review", "shipped", "parked"] as const;
const TEAMS = ["north", "south", "east"] as const;
const EFFORTS = [1, 2, 3, 8, 13] as const;
const SORTABLE = ["stage", "team", "effort"] as const;
/** Values that aren't an option: missing, empty, null, the wrong type, a near-miss, an unknown word. */
const ODD = [undefined, "", null, 4, true, "QUEUED", "Active ", "blocked"] as const;

const binderArb = fc.shuffledSubarray([...OPTIONS], { minLength: 1 }).chain((options) => {
  const properties: Properties = {
    stage: { type: "select", options, required: false },
    team: { type: "select", options: [...TEAMS], required: false },
    effort: { type: "number", required: false },
  };
  const spec = fc.record(
    {
      stage: fc.oneof({ weight: 3, arbitrary: fc.constantFrom<unknown>(...OPTIONS) }, { weight: 2, arbitrary: fc.constantFrom<unknown>(...ODD) }),
      team: fc.constantFrom(...TEAMS),
      effort: fc.constantFrom(...EFFORTS),
    },
    { requiredKeys: [] },
  );
  return fc.uniqueArray(fc.integer({ min: 1, max: 400 }), { maxLength: 30 }).chain((numbers) =>
    fc.array(spec, { minLength: numbers.length, maxLength: numbers.length }).map((specs) => ({
      options,
      properties,
      items: specs.map((each, at) => item(numbers[at] ?? at + 1, Object.fromEntries(Object.entries(each).filter(([, value]) => value !== undefined)))),
    })),
  );
});

const viewArb: fc.Arbitrary<BoardView> = fc.record(
  {
    name: fc.constant("Flow"),
    kind: fc.constant("board" as const),
    column: fc.constant("stage"),
    filter: fc.record({ team: fc.constantFrom(...TEAMS), effort: fc.constantFrom(...EFFORTS) }, { requiredKeys: [] }),
    sort: fc.shuffledSubarray([...SORTABLE]),
  },
  { requiredKeys: ["name", "kind", "column"] },
);

/** The option an item's card belongs under, by hand: its value when it is one of the options, else none (null). */
const homeOf = (options: readonly string[], value: unknown): string | null => (typeof value === "string" && options.includes(value) ? value : null);

describe("boardColumns", () => {
  test("for any items and board view: every shown item in exactly its value's column, options in order, No value first and only with cards, the list views' order within", () => {
    fc.assert(
      fc.property(binderArb, viewArb, ({ options, properties, items }, view) => {
        const rows = rowsOf(items);
        const columns = boardColumns(rows, view, properties);
        const visible = visibleItems(rows, view, properties).map(itemOf);
        const order = sorted(visibleItems(rows, view, properties), view, properties).map(itemOf);
        const cards = columns.flatMap((column) => column.rows.map(itemOf));

        expect(handles(cards).sort(), "each shown item once, and only those").toEqual(handles(visible).sort());
        expect(
          columns.filter((column) => column.kind === "value").map((column) => column.value),
          "one column per option, in option order",
        ).toEqual(options);
        const homeless = visible.some((one) => homeOf(options, one.properties["stage"]) === null);
        expect(columns.filter((column) => column.kind === "none").length, "a No value column only when it has cards").toBe(homeless ? 1 : 0);
        if (homeless) expect(columns[0]?.kind, "No value comes first").toBe("none");

        for (const column of columns) {
          const want = column.kind === "value" ? column.value : null;
          const held = column.rows.map(itemOf);
          for (const card of held) expect(homeOf(options, card.properties["stage"]), `${String(card.handle)} under ${String(want)}`).toBe(want);
          expect(handles(held), `${String(want)}: the view's order`).toEqual(handles(order.filter((one) => held.includes(one))));
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ---- Moves the items don't show yet ----

const PATH = item(1).path;
const OTHER = item(2).path;
const v = (n: number): string => String(n).repeat(64);

/** Saved moves and a cached version: which moves still show, and the version the next drop of the card names. */
const MOVE_CASES: { what: string; moves: Move[]; cached: string; shown: number[]; sends: string }[] = [
  { what: "a move still saving, the cache as read", moves: [{ path: PATH, value: "active", version: v(1) }], cached: v(1), shown: [0], sends: v(1) },
  {
    what: "a saved move, the cache not yet caught up",
    moves: [{ path: PATH, value: "active", version: v(1), answered: v(2) }],
    cached: v(1),
    shown: [0],
    sends: v(2),
  },
  { what: "a saved move, the cache holding its answer", moves: [{ path: PATH, value: "active", version: v(1), answered: v(2) }], cached: v(2), shown: [], sends: v(2) },
  {
    what: "a saved move, the file written from elsewhere since",
    moves: [{ path: PATH, value: "active", version: v(1), answered: v(2) }],
    cached: v(9),
    shown: [],
    sends: v(9),
  },
  {
    what: "two saved moves, the cache holding the first one's answer",
    moves: [
      { path: PATH, value: "active", version: v(1), answered: v(2) },
      { path: PATH, value: "review", version: v(2), answered: v(3) },
    ],
    cached: v(2),
    shown: [1],
    sends: v(3),
  },
  {
    what: "a saved move of another card",
    moves: [{ path: OTHER, value: "active", version: v(1), answered: v(2) }],
    cached: v(1),
    shown: [0],
    sends: v(1),
  },
];

describe("moves not yet in the items", () => {
  test.each(MOVE_CASES)("$what", ({ moves, cached, shown, sends }) => {
    const items = [item(1, { stage: "queued" }, cached), item(2, { stage: "queued" }, v(1))];

    const live = liveMoves(moves, items);

    expect(live, "the moves still shown").toEqual(shown.map((at) => moves[at]));
    expect(versionToSend(items[0] ?? item(1), live), "the version a drop of the card names").toBe(sends);
  });
});
