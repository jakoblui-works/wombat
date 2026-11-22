// A page that runs script can't read or write the clipboard, or change the items folder, on its own: those commands
// run only right after the user's own click or key in the window.
import { expect, test } from "vitest";

import { type PageAction, pageMayRun, USER_INPUT_MS } from "./user-input.ts";

const INPUT_ONLY: readonly PageAction[] = ["workspace.chooseItemsFolder", "edit.cut", "edit.copy", "edit.paste"];

test.each(INPUT_ONLY)("%s runs only right after the user's input", (id) => {
  const now = 1_000_000;
  expect(pageMayRun(id, undefined, now), "with no input yet").toBe(false);
  expect(pageMayRun(id, now - USER_INPUT_MS - 1, now), "with input too long ago").toBe(false);
  expect(pageMayRun(id, now, now), "right after input").toBe(true);
  expect(pageMayRun(id, now - USER_INPUT_MS, now), "within the window").toBe(true);
});
