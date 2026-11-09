// Lasting check (silent failure): the scripted fake agent is never offered outside tests.
import { expect, test } from "vitest";

import { claudeCode } from "./claude-code.ts";
import { defaultHarnesses, findHarness } from "./registry.ts";

test("the fake harness is not registered: not in defaultHarnesses, and findHarness('fake') is undefined", () => {
  expect(defaultHarnesses.map((harness) => harness.id)).not.toContain("fake");
  expect(findHarness("fake")).toBeUndefined();
  // Control: lookup by id works, so the undefined above means "not registered".
  expect(findHarness(claudeCode.id)).toBe(claudeCode);
});
