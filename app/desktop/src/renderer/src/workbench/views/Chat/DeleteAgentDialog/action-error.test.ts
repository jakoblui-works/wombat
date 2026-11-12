// A stop or delete failure shows once beside the agent: not while the delete dialog is open (it shows its own), not
// after that dialog closes, and not once the agent's state moved on; a new failure shows again.
import { expect, test } from "vitest";

import { dismissedAfter, shownError } from "./action-error.ts";

const stopFailed = new Error("Couldn't stop the agent.");
const deleteFailed = new Error("Couldn't delete the agent.");

test("a stop failure shows until the agent's state moves on", () => {
  expect(shownError(stopFailed, undefined, false)).toBe(stopFailed);
  const dismissed = dismissedAfter({ state: "working", confirming: false }, { state: "error", confirming: false }, stopFailed, undefined);
  expect(shownError(stopFailed, dismissed, false)).toBeUndefined();
  expect(shownError(new Error("Again."), dismissed, false)?.message).toBe("Again.");
});

test("a delete failure shows in the dialog only: not beside the agent while it's open, nor after it closes", () => {
  expect(shownError(deleteFailed, undefined, true)).toBeUndefined();
  const dismissed = dismissedAfter({ state: "done", confirming: true }, { state: "done", confirming: false }, deleteFailed, undefined);
  expect(shownError(deleteFailed, dismissed, false)).toBeUndefined();
});
