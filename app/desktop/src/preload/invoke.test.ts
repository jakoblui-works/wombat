// The preload's changes to a bridge call: the patch it sends, and the error the page gets back.
import { expect, test } from "vitest";

import { mainError, withoutUndefined } from "./invoke.ts";

test("a settings patch loses its undefined fields and keeps the rest, falsy values included", () => {
  expect(withoutUndefined({ askOnQuit: false, lastAgentFolder: undefined, layout: null })).toEqual({ askOnQuit: false, layout: null });
  expect(Object.keys(withoutUndefined({ layout: undefined }))).toEqual([]);
});

test("an error from main reaches the page with main's message, without Electron's wrapping", () => {
  const wrapped = new Error("Error invoking remote method 'wombat:settings:set': Error: The settings change isn't valid; send only askOnQuit.");
  expect(mainError(wrapped).message).toBe("The settings change isn't valid; send only askOnQuit.");
  expect(mainError(new Error("Not wrapped.")).message).toBe("Not wrapped.");
});
