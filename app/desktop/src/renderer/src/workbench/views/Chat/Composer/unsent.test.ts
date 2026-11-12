// A first message the New agent dialog couldn't send opens in the agent's message box as a failed send, once.
import { expect, test } from "vitest";

import { EMPTY_COMPOSER } from "./composer-state.ts";
import { forgetUnsent, handOverUnsent, openingComposer } from "./unsent.ts";

test("a handed-over message opens with its text and error in that agent's box only, until it's forgotten", () => {
  handOverUnsent("agent-bakery-1", "Fix the hours", new Error("Lost."));

  expect(openingComposer("agent-bakery-1")).toEqual({ text: "Fix the hours", error: "Lost." });
  expect(openingComposer("agent-bakery-2")).toEqual(EMPTY_COMPOSER);
  forgetUnsent("agent-bakery-1");
  expect(openingComposer("agent-bakery-1")).toEqual(EMPTY_COMPOSER);
});
