// S7 T13 (silent failure): a huge tool input or output never reaches the page whole. `clipText` keeps the first `max`
// characters and says how many it left out; a text that fits is shown whole and nothing is said to be missing.
// Values come from the exported constant, never a copy of it.
import fc from "fast-check";
import { expect, test } from "vitest";

import { clipText, MAX_SHOWN_CHARS } from "./clip-text.ts";

test("the shown part is the text's start, at most max long, and shown plus omitted is the whole length", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }), fc.integer({ min: 1, max: 40 }), (text, max) => {
      const { shown, omitted } = clipText(text, max);
      expect(text.startsWith(shown)).toBe(true);
      expect(shown.length).toBe(Math.min(text.length, max));
      expect(shown.length + omitted).toBe(text.length);
    }),
  );
});

test("at the default limit: one character over is clipped and counted, exactly at it nothing is", () => {
  const atLimit = "a".repeat(MAX_SHOWN_CHARS);
  expect(clipText(atLimit)).toEqual({ shown: atLimit, omitted: 0 });
  expect(clipText("")).toEqual({ shown: "", omitted: 0 });

  const huge = `${atLimit}bcd`;
  expect(clipText(huge)).toEqual({ shown: atLimit, omitted: 3 });
});
