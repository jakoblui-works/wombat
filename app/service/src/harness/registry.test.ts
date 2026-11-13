import { expect, test } from "vitest";

import { claudeCode } from "./claude-code.ts";
import { harnessFeatures } from "./registry.ts";

// The app offers a stopped agent's chat only when its harness lists "resume", and /context only when it lists "context".
test("a harness lists the resume feature exactly when it is resumable, and context exactly when it reports one", () => {
  expect(harnessFeatures(claudeCode)).toContain("resume");
  const withoutResume = { ...claudeCode };
  delete withoutResume.resumable;
  expect(harnessFeatures(withoutResume)).not.toContain("resume");
  expect(harnessFeatures({ ...claudeCode, resumable: false })).not.toContain("resume");

  expect(harnessFeatures(claudeCode)).toContain("context");
  const withoutContext = { ...claudeCode };
  delete withoutContext.contextBreakdown;
  expect(harnessFeatures(withoutContext)).not.toContain("context");
});
