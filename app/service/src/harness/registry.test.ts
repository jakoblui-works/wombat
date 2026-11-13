// Lasting check (silent failure): the scripted fake agent is never offered outside tests.
import { expect, test } from "vitest";

import { claudeCode } from "./claude-code.ts";
import { defaultHarnesses, findHarness, harnessFeatures } from "./registry.ts";

test("the fake harness is not registered: not in defaultHarnesses, and findHarness('fake') is undefined", () => {
  expect(defaultHarnesses.map((harness) => harness.id)).not.toContain("fake");
  expect(findHarness("fake")).toBeUndefined();
  // Control: lookup by id works, so the undefined above means "not registered".
  expect(findHarness(claudeCode.id)).toBe(claudeCode);
});

// S2d: the app offers a stopped agent's chat only when its harness lists "resume".
test("a harness lists the resume feature exactly when it is resumable", () => {
  expect(harnessFeatures(claudeCode)).toContain("resume");
  const withoutResume = { ...claudeCode };
  delete withoutResume.resumable;
  expect(harnessFeatures(withoutResume)).not.toContain("resume");
  expect(harnessFeatures({ ...claudeCode, resumable: false })).not.toContain("resume");
});
