// Where the effort slider rests after a pick: on the pick while its change is under way, whatever the agent's value
// passes through (a resume restores the stored settings first), then until the agent's value moves or the change fails.
import { expect, test } from "vitest";

import { holds } from "./slider-hold.ts";

const pick = { index: 3, from: "medium" };

test.each([
  ["under way, the agent's value still the old one: held", { ...pick, settled: false }, "medium", undefined, true],
  ["under way, a resume passing through another value: held", { ...pick, settled: false }, "low", undefined, true],
  ["under way, the agent's value already the picked one: held", { ...pick, settled: false }, "max", undefined, true],
  ["answered, the agent's value not yet moved: held", { ...pick, settled: true }, "medium", undefined, true],
  ["answered, the agent's value moved: released", { ...pick, settled: true }, "max", undefined, false],
  ["answered with a failure, the agent's value not moved: released", { ...pick, settled: true }, "medium", "The agent didn't answer.", false],
  ["no pick: nothing held", undefined, "medium", undefined, false],
] as const)("%s", (_, hold, current, failure, held) => {
  expect(holds(hold, current, failure)).toBe(held);
});
