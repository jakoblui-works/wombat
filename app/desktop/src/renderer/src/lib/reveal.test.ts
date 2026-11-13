// The bounds useReveal relies on to show streamed text in order and keep up with the stream: a step never passes the
// text that has arrived, never goes back, catches up at once after a burst bigger than the lag bound, and otherwise
// moves at the set rate. Values come from the exported constants.
import fc from "fast-check";
import { expect, test } from "vitest";

import { CHARS_PER_SECOND, MAX_LAG_CHARS, revealStep } from "./reveal.ts";

test("a step stays between shown and target, catches up above the lag bound, and otherwise moves at CHARS_PER_SECOND", () => {
  const state = fc
    .record({
      shown: fc.oneof(fc.integer({ min: 0, max: 5_000 }), fc.double({ min: 0, max: 5_000, noNaN: true })),
      lag: fc.oneof(fc.integer({ min: 0, max: MAX_LAG_CHARS * 3 }), fc.constantFrom(0, MAX_LAG_CHARS, MAX_LAG_CHARS + 1)),
      elapsedMs: fc.oneof(fc.double({ min: 0, max: 5_000, noNaN: true }), fc.constantFrom(0, 16.7, 1_000)),
    })
    .map(({ shown, lag, elapsedMs }) => ({ shown, target: Math.floor(shown) + lag, elapsedMs }))
    .filter(({ shown, target }) => shown <= target);

  fc.assert(
    fc.property(state, ({ shown, target, elapsedMs }) => {
      const next = revealStep(shown, target, elapsedMs);
      expect(next).toBeLessThanOrEqual(target);
      expect(next).toBeGreaterThanOrEqual(shown);
      if (target - shown > MAX_LAG_CHARS) {
        expect(next).toBe(target);
      } else {
        const paced = Math.min(target, shown + (elapsedMs * CHARS_PER_SECOND) / 1000);
        expect(next).toBeGreaterThanOrEqual(Math.floor(paced));
        expect(next).toBeLessThanOrEqual(Math.ceil(paced));
      }
    }),
    { numRuns: 2_000 },
  );
});
