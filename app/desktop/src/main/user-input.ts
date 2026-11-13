// Whether the page may run a clipboard command now: only right after the user's own input to its window, so a page
// that runs script can't read or write the clipboard on its own.
import type { InputEvent } from "electron";
import type { MainCommandId } from "../shared/bridge.ts";

/** How long after the user's last click, key press or touch the page may still use the clipboard. */
export const CLIPBOARD_INPUT_MS = 1_000;

const CLIPBOARD_COMMANDS: ReadonlySet<MainCommandId> = new Set(["edit.cut", "edit.copy", "edit.paste"]);

const USER_INPUT: ReadonlySet<InputEvent["type"]> = new Set([
  "mouseDown",
  "mouseUp",
  "contextMenu",
  "rawKeyDown",
  "keyDown",
  "keyUp",
  "char",
  "touchStart",
  "touchEnd",
  "gestureTap",
]);

/** Whether an input event is the user acting (a click, a key, a touch), not a pointer passing over the page. */
export const isUserInput = (type: InputEvent["type"]): boolean => USER_INPUT.has(type);

/** Whether the page may run `id` now: any command but a clipboard one, which needs user input within CLIPBOARD_INPUT_MS. */
export const pageMayRun = (id: MainCommandId, lastInputAt: number | undefined, now: number): boolean =>
  !CLIPBOARD_COMMANDS.has(id) || (lastInputAt !== undefined && now >= lastInputAt && now - lastInputAt <= CLIPBOARD_INPUT_MS);
