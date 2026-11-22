// Whether the page may run a clipboard command or open the items folder picker now: only right after the user's own
// input to its window, so a page that runs script can't read or write the clipboard, or change the items folder, on
// its own.
import type { InputEvent } from "electron";
import type { MainCommandId } from "../shared/bridge.ts";

const CLIPBOARD_REFUSAL = "Cut, copy and paste run only right after you click or press a key in the window. Use them from the Edit menu or with their keys.";
const ITEMS_FOLDER_REFUSAL =
  "The items folder can be chosen only right after you click or press a key in the window. Use Choose Items Folder… in the File menu or the Desk's button.";

/** How long after the user's last click, key press or touch the page may still run an INPUT_ONLY command. */
export const USER_INPUT_MS = 1_000;

/** Each command that runs only right after the user's input, with the refusal the page gets without it. */
const INPUT_ONLY: Partial<Record<MainCommandId, string>> = {
  "edit.cut": CLIPBOARD_REFUSAL,
  "edit.copy": CLIPBOARD_REFUSAL,
  "edit.paste": CLIPBOARD_REFUSAL,
  "items.chooseFolder": ITEMS_FOLDER_REFUSAL,
};

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

/** Whether the page may run `id` now: any command but an INPUT_ONLY one, which needs user input within USER_INPUT_MS. */
export const pageMayRun = (id: MainCommandId, lastInputAt: number | undefined, now: number): boolean =>
  INPUT_ONLY[id] === undefined || (lastInputAt !== undefined && now >= lastInputAt && now - lastInputAt <= USER_INPUT_MS);

/** What the page is told when pageMayRun refuses `id`. */
export const refusalWithoutInput = (id: MainCommandId): string => INPUT_ONLY[id] ?? CLIPBOARD_REFUSAL;
