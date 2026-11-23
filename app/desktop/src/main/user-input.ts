// Whether the page may run a clipboard command or open a folder picker now: only right after the user's own input to
// its window, so a page that runs script can't read or write the clipboard, change the items folder, add a workspace or
// open picker after picker on its own.
import type { InputEvent, WebContents } from "electron";
import type { MainCommandId } from "../shared/bridge.ts";

const CLIPBOARD_REFUSAL = "Cut, copy and paste run only right after you click or press a key in the window. Use them from the Edit menu or with their keys.";
const ITEMS_FOLDER_REFUSAL =
  "The items folder can be chosen only right after you click or press a key in the window. Use Choose Items Folder… in the File menu or the Desk's button.";
const WORKSPACE_REFUSAL = "A workspace can be added only right after you click or press a key in the window. Use File → Open Folder….";

/** What the page asks main to do: a main command, or a bridge call that opens a folder picker. */
export type PageAction = MainCommandId | "workspace.add" | "workspace.chooseItemsFolder";

/** How long after the user's last click, key press or touch the page may still run an INPUT_ONLY action. */
export const USER_INPUT_MS = 1_000;

/** Each action that runs only right after the user's input, with the refusal the page gets without it. */
const INPUT_ONLY: Partial<Record<PageAction, string>> = {
  "edit.cut": CLIPBOARD_REFUSAL,
  "edit.copy": CLIPBOARD_REFUSAL,
  "edit.paste": CLIPBOARD_REFUSAL,
  "workspace.chooseItemsFolder": ITEMS_FOLDER_REFUSAL,
  "workspace.add": WORKSPACE_REFUSAL,
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

/** Whether the page may run `id` now: any action but an INPUT_ONLY one, which needs user input within USER_INPUT_MS. */
export const pageMayRun = (id: PageAction, lastInputAt: number | undefined, now: number): boolean =>
  INPUT_ONLY[id] === undefined || (lastInputAt !== undefined && now >= lastInputAt && now - lastInputAt <= USER_INPUT_MS);

/** What the page is told when pageMayRun refuses `id`. */
export const refusalWithoutInput = (id: PageAction): string => INPUT_ONLY[id] ?? CLIPBOARD_REFUSAL;

export type InputGate = {
  /** Notes the user's input to `contents`, for `check`. */
  watch: (contents: WebContents) => void;
  /** Throws refusalWithoutInput's message when the page of `contents` may not run `id` now (pageMayRun). */
  check: (id: PageAction, contents: WebContents | undefined) => void;
};

/** The one record of each window's last user input, for every action the page asks of main. */
export const inputGate = (now: () => number = Date.now): InputGate => {
  const lastInputAt = new WeakMap<WebContents, number>();
  return {
    watch: (contents) => {
      contents.on("input-event", (_event, input) => {
        if (isUserInput(input.type)) lastInputAt.set(contents, now());
      });
    },
    check: (id, contents) => {
      if (!pageMayRun(id, contents === undefined ? undefined : lastInputAt.get(contents), now())) throw new Error(refusalWithoutInput(id));
    },
  };
};
