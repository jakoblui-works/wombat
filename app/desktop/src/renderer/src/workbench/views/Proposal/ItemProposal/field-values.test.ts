// What a typed property value proposes. A number box's text becomes a number only when it reads back exactly as that
// number; any other text stays as typed, so the box keeps it (`0.` on the way to `0.5`) and the service checks it.
import fc from "fast-check";
import { expect, test } from "vitest";

import type { LenientProperty } from "@wombat/shared/items";

import { typedValue } from "./field-values.ts";

const NUMBER: LenientProperty = { type: "number", required: false };

test.each<[string, unknown]>([
  ["", null],
  ["5", 5],
  ["-2.5", -2.5],
  ["0.", "0."],
  ["05", "05"],
  ["1.50", "1.50"],
  [" 5", " 5"],
  ["abc", "abc"],
])("a number property's text %j proposes %j", (text, proposed) => {
  expect(typedValue(text, NUMBER)).toEqual(proposed);
});

test("any finite number, typed as it reads, is proposed as that number", () => {
  const typed = fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0));
  fc.assert(
    fc.property(typed, (n) => {
      expect(typedValue(String(n), NUMBER)).toBe(n);
    }),
  );
});
