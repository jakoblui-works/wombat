// A card held on the board. Held by mouse, its own node stays rendered (hidden) in its home column, since the browser
// ends the drag on that node, while a copy previews where it is held. A hold ends once its card is no longer in its
// home column (it was moved or written meanwhile), and a keyboard hold ends when its card loses focus.
import { describe, expect, test } from "vitest";

import type { ItemSummary } from "@wombat/shared/items";

import type { Column } from "./board-columns.ts";
import { drag, type DragEvent, type Held, shownCards } from "./board-drag.ts";

// ---- Invented cards ----

const card = (n: number): ItemSummary => ({
  id: `0196f3c2-7e00-7000-8000-${n.toString(16).padStart(12, "0")}`,
  handle: `OPS-${String(n)}`,
  aliases: [],
  title: `Invented card ${String(n)}`,
  properties: {},
  path: `ops/OPS-${String(n)}-card.md`,
  version: "0".repeat(64),
  problems: [],
});

const MOVED = card(1);
const STAYS = card(2);
const ELSEWHERE = card(3);

const column = (value: string, cards: ItemSummary[]): Column => ({ key: `value:${value}`, kind: "value", value, rows: cards.map((one) => ({ item: one })) });

const QUEUED = "value:queued";
const ACTIVE = "value:active";
const BEFORE = [column("queued", [MOVED, STAYS]), column("active", [ELSEWHERE])];
const AFTER = [column("queued", [STAYS]), column("active", [ELSEWHERE, MOVED])];

const run = (events: DragEvent[], from: Held | undefined = undefined): Held | undefined => events.reduce(drag, from);
const pick = (byMouse: boolean): DragEvent => ({ type: "pick", id: MOVED.path, from: QUEUED, byMouse });

describe("a held card", () => {
  test("held by mouse over another column: hidden but still rendered at home, a preview where it is held, nowhere else", () => {
    const held = run([pick(true), { type: "over", column: ACTIVE }]);

    const shown = (key: string) => shownCards(key, BEFORE, AFTER, held).map(({ row, mode }) => ({ path: row.item.path, mode }));

    expect(shown(QUEUED)).toEqual([
      { path: MOVED.path, mode: "hidden" },
      { path: STAYS.path, mode: "card" },
    ]);
    expect(shown(ACTIVE)).toEqual([
      { path: ELSEWHERE.path, mode: "card" },
      { path: MOVED.path, mode: "preview" },
    ]);
  });

  test.each([{ by: "mouse", byMouse: true }, { by: "keyboard", byMouse: false }])("held by $by: the hold lasts while its card is home, and ends once it isn't", ({ byMouse }) => {
    const held = run([pick(byMouse)]);
    expect(held, "picked up").toBeDefined();

    expect(run([{ type: "cards", columns: BEFORE }], held), "still in its home column").toEqual(held);
    expect(run([{ type: "cards", columns: AFTER }], held), "moved out of its home column").toBeUndefined();
    expect(run([{ type: "cards", columns: [column("queued", [STAYS])] }], held), "gone from the board").toBeUndefined();
  });

  test("held by keyboard, the hold ends when its card loses focus; another card's blur, or a mouse hold, doesn't end it", () => {
    const byKeyboard = run([pick(false), { type: "step", by: 1, columns: [QUEUED, ACTIVE] }]);
    expect(byKeyboard?.over, "moved by an arrow key").toBe(ACTIVE);

    expect(run([{ type: "blur", id: MOVED.path }], byKeyboard)).toBeUndefined();
    expect(run([{ type: "blur", id: STAYS.path }], byKeyboard)).toEqual(byKeyboard);
    const byMouse = run([pick(true)]);
    expect(run([{ type: "blur", id: MOVED.path }], byMouse)).toEqual(byMouse);
  });
});
