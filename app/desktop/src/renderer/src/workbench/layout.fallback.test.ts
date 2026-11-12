// The restore says when it fell back to the default although a layout was saved: the saver must then leave the saved
// layout alone until the user changes something.
import { expect, test, vi } from "vitest";

import "./activities.ts";
import { defaultLayout, restoreLayout } from "./layout.ts";

test.each<[string, unknown, boolean]>([
  ["a layout that can't be read", { version: 2 }, true],
  ["nothing saved yet", undefined, false],
  ["a layout that restores", defaultLayout(), false],
])("%s: onFallback called is %s", (_name, raw, expected) => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let fellBack = false;
  restoreLayout(raw, () => true, () => undefined, () => {
    fellBack = true;
  });
  expect(fellBack).toBe(expected);
  vi.restoreAllMocks();
});
