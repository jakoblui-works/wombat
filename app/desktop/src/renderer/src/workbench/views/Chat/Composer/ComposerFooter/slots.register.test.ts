import { expect, test } from "vitest";

import { hiddenOptionsFor, registerHarnessUi } from "./slots.ts";

test("a second registration for one harness is refused", () => {
  registerHarnessUi("t14-twice-harness", {});
  expect(() => registerHarnessUi("t14-twice-harness", {})).toThrow(/already registered/);
});

test("hiddenOptionsFor lists a harness's hidden option ids, and none for an unregistered one", () => {
  registerHarnessUi("t-hidden-harness", { hiddenOptions: ["agent"] });
  expect(hiddenOptionsFor("t-hidden-harness")).toEqual(["agent"]);
  expect(hiddenOptionsFor("t-unregistered-harness")).toEqual([]);
});
