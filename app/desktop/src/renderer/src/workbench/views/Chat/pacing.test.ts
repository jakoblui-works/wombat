// Which agent messages keep revealing their text at a pace: a block that stops being written (a tool call followed,
// the turn ended) keeps revealing until its reveal has caught up, so the rest of a reply never jumps in at once.
import fc from "fast-check";
import { expect, test } from "vitest";

import { caughtUp, followStreaming, NO_PACING, revealDone, stillReveals } from "./pacing.ts";

const KEYS = ["a", "b", "c"] as const;

const step = fc.oneof(
  fc.record({ kind: fc.constant("stream" as const), key: fc.constantFrom(...KEYS, undefined) }),
  fc.record({ kind: fc.constant("caught_up" as const), key: fc.constantFrom(...KEYS) }),
);

test("a block that stops being written still reveals until it has caught up, and then no longer", () => {
  fc.assert(
    fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
      let pacing = NO_PACING;
      for (const { kind, key } of steps) {
        const revealing = KEYS.filter((k) => stillReveals(pacing, k));
        if (kind === "stream") {
          const next = followStreaming(pacing, key);
          if (key === pacing.streaming) expect(next).toBe(pacing);
          if (key !== undefined) expect(stillReveals(next, key)).toBe(true);
          for (const k of KEYS) expect(stillReveals(next, k), k).toBe(revealing.includes(k) || k === key);
          pacing = next;
        } else {
          const next = caughtUp(pacing, key);
          // Text still arriving keeps the block being written paced.
          expect(stillReveals(next, key)).toBe(key === pacing.streaming);
          for (const k of KEYS) if (k !== key) expect(stillReveals(next, k), k).toBe(revealing.includes(k));
          pacing = next;
        }
      }
    }),
    { numRuns: 1_000 },
  );
});

test("a paced message is done only once it is no longer being written and shows all of its text", () => {
  const text = "The tests pass.";
  expect(revealDone(true, text, text)).toBe(false);
  expect(revealDone(false, text.slice(0, 4), text)).toBe(false);
  expect(revealDone(false, text, text)).toBe(true);
});
