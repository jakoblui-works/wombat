// Each agent's message box lives outside its chat (one chat is mounted at a time): a first message the New agent dialog
// couldn't send opens in it as a failed send, once; a send that settles after its chat was switched away lands in it.
import { expect, test } from "vitest";

import { EMPTY_COMPOSER } from "./composer-state.ts";
import { composerEvent, forgetUnsent, handOverUnsent, openingComposer } from "./unsent.ts";

test("a handed-over message opens with its text and error in that agent's box only, until it's forgotten", () => {
  handOverUnsent("agent-bakery-1", "Fix the hours", new Error("Lost."));

  expect(openingComposer("agent-bakery-1")).toEqual({ text: "Fix the hours", error: "Lost." });
  expect(openingComposer("agent-bakery-2")).toEqual(EMPTY_COMPOSER);
  forgetUnsent("agent-bakery-1");
  expect(openingComposer("agent-bakery-1")).toEqual(EMPTY_COMPOSER);
});

test("a send that fails after its chat was switched away comes back with its text and why it failed", () => {
  // The chat sends, then stops showing (nothing reads the box) before the send settles.
  composerEvent("agent-oven-1", { type: "edit", text: "Raise the oven to 220" });
  composerEvent("agent-oven-1", { type: "send" });
  composerEvent("agent-oven-2", { type: "edit", text: "Check the proofing drawer" });
  composerEvent("agent-oven-1", { type: "failed", message: "The agent couldn't start." });

  expect(openingComposer("agent-oven-1")).toEqual({ text: "Raise the oven to 220", error: "The agent couldn't start." });
  expect(openingComposer("agent-oven-2")).toEqual({ text: "Check the proofing drawer" });
  forgetUnsent("agent-oven-1");
  forgetUnsent("agent-oven-2");
});
