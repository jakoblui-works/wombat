// What a typed property value proposes. A number box's text becomes a number only when it is a plain decimal (an
// optional minus, digits, optionally a point and digits); any other text, exponents too, stays as typed, never
// stripped, so the box keeps it (`0.` on the way to `0.5`) and the service checks it.
import fc from "fast-check";
import { expect, test } from "vitest";

import type { LenientProperty } from "@wombat/shared/items";

import { typedValue } from "./field-values.ts";

const NUMBER: LenientProperty = { type: "number", required: false };

test.each<[string, unknown]>([
  ["", null],
  ["5", 5],
  ["0.", "0."],
])("a number property's text %j proposes %j", (text, proposed) => {
  expect(typedValue(text, NUMBER)).toEqual(proposed);
});

/** A plain decimal, written by hand apart from the code: an optional minus, digits, optionally a point and digits. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

test("any finite number, typed as it reads, is proposed as that number when it reads as a plain decimal, else as typed", () => {
  const typed = fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0));
  fc.assert(
    fc.property(typed, (n) => {
      const text = String(n);
      expect(typedValue(text, NUMBER), `"${text}"`).toBe(PLAIN_DECIMAL.test(text) ? n : text);
    }),
  );
});
