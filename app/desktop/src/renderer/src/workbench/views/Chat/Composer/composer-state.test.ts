// s7-14: the message box. Enter sends, Shift+Enter is a new line; Send needs text, no turn under way and a connection;
// a failed send keeps the text and says why; a sent one clears the box.
import { expect, test } from "vitest";

import { canSend, composerReducer, type ComposerEvent, type ComposerState, EMPTY_COMPOSER } from "./composer-state.ts";

const run = (...events: ComposerEvent[]): ComposerState => events.reduce(composerReducer, EMPTY_COMPOSER);
const ready = { turnActive: false, connected: true };

test("a failed send keeps the text and shows why; a successful one clears the box", () => {
  const failed = run({ type: "edit", text: "Go on" }, { type: "send" }, { type: "failed", message: "The agent is busy." });
  expect(failed).toEqual({ text: "Go on", error: "The agent is busy." });
  expect(canSend(failed, ready)).toBe(true);
  expect(run({ type: "edit", text: "Go on" }, { type: "send" }, { type: "sent" }).text).toBe("");
});

test("text edited while the send is under way stays when it succeeds: only the sent text is cleared", () => {
  const edited = run({ type: "edit", text: "Go on" }, { type: "send" }, { type: "edit", text: "Go on, and add a test" }, { type: "sent" });
  expect(edited.text).toBe("Go on, and add a test");
});
