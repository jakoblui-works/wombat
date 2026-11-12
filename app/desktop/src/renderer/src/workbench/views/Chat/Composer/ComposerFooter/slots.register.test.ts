import { expect, test } from "vitest";

import { registerHarnessUi } from "./slots.ts";

test("a second registration for one harness is refused", () => {
  registerHarnessUi("t14-twice-harness", {});
  expect(() => registerHarnessUi("t14-twice-harness", {})).toThrow(/already registered/);
});
