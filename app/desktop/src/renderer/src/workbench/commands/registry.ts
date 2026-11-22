// Every action the page offers, by id: keys, menus, buttons and the tab context menu run them through here, so each
// entry point does the same thing and a custom key or a palette needs nothing but this registry. Importing this
// module registers the main commands; it touches no `window` until a command runs.
import { useCallback } from "react";

import { MAIN_COMMAND_IDS, type MainCommandId } from "../../../../shared/bridge.ts";

/**
 * What a command acts on when it isn't the active group or tab: the clicked tab's or group's ids, or a scoped command's
 * element. `keep`: what the command opens is kept, not temporary (a menu's Open sets it; keys never do).
 */
export type CommandTarget = { groupId?: string; panelId?: string; element?: Element; keep?: boolean };

/**
 * An action the user can take. `keys` are written like VS Code's keybindings (`"ctrl+shift+w"`, `"ctrl+="`,
 * `"ctrl+numpad0"`) and bind by physical key, so every key in it runs the command; a key without ctrl, alt or meta
 * (other than a function key) needs a `scope`. A scoped command takes its key only on an element inside a root marked
 * with its scope (`useCommandScope`) that has a handler for it, and never in an editable element or a button there.
 * `when` decides, at each key, whether the command takes its key; `run` gets the target the entry point passed (none
 * for menus, the element for a scoped command's key: the command acts on the active group or tab when the target names
 * none; a scoped command runs its root's handler through `runInScope`). `shownKeys` are shown in menus
 * without being bound: for a command the page's own elements already handle on those keys (the edit commands, which
 * a text field runs itself), where a binding would run it twice.
 */
export type Command = {
  id: string;
  title: string;
  keys?: readonly string[];
  shownKeys?: readonly string[];
  when?: () => boolean;
  scope?: string;
  run: (target: CommandTarget) => void | Promise<void>;
};

/** A key string, parsed: the modifiers it needs and the physical key (KeyboardEvent.code). */
export type KeyChord = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; code: string };

const MODIFIERS = ["ctrl", "shift", "alt", "meta"] as const;

const NAMED_CODES: Record<string, string> = {
  "=": "Equal",
  "-": "Minus",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "`": "Backquote",
  enter: "Enter",
  escape: "Escape",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  numpad_add: "NumpadAdd",
  numpad_subtract: "NumpadSubtract",
  numpad_multiply: "NumpadMultiply",
  numpad_divide: "NumpadDivide",
  numpad_decimal: "NumpadDecimal",
  numpad_enter: "NumpadEnter",
};

/** How a key shows in a menu, where its name alone wouldn't read well. */
const KEY_LABELS: Record<string, string> = {
  NumpadAdd: "Numpad+",
  NumpadSubtract: "Numpad-",
  NumpadMultiply: "Numpad*",
  NumpadDivide: "Numpad/",
  NumpadDecimal: "Numpad.",
  NumpadEnter: "Numpad Enter",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** The KeyboardEvent.code for a key name: a letter, a digit, f1-f24, numpad0-9 or a NAMED_CODES name. */
const codeFor = (name: string): string | undefined => {
  if (/^[a-z]$/.test(name)) return `Key${name.toUpperCase()}`;
  if (/^[0-9]$/.test(name)) return `Digit${name}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(name)) return name.toUpperCase();
  if (/^numpad[0-9]$/.test(name)) return `Numpad${name.slice(-1)}`;
  return NAMED_CODES[name];
};

/** Parses one key string; throws, naming it, for a modifier or key it doesn't know. */
export const parseKeys = (keys: string): KeyChord => {
  const parts = keys.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  const chord: KeyChord = { ctrl: false, shift: false, alt: false, meta: false, code: "" };
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part)) {
      throw new Error(`The key string "${keys}" has an unknown modifier "${part}"; use ${MODIFIERS.join(", ")}.`);
    }
    chord[part as (typeof MODIFIERS)[number]] = true;
  }
  const code = codeFor(key);
  if (code === undefined) throw new Error(`The key string "${keys}" ends in an unknown key "${key}"; name a letter, digit, f-key, numpad key or one of ${Object.keys(NAMED_CODES).join(" ")}.`);
  return { ...chord, code };
};

/** The single-character key names by code ("Equal" shows as "="). */
const SYMBOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(NAMED_CODES)
    .filter(([name]) => name.length === 1)
    .map(([name, code]) => [code, name]),
);

/** A chord as a menu shows it: "Ctrl+Shift+W", "Ctrl+=", "Ctrl+Numpad0". */
const chordLabel = ({ ctrl, shift, alt, meta, code }: KeyChord): string => {
  const key = KEY_LABELS[code] ?? SYMBOL_LABELS[code] ?? code.replace(/^(Key|Digit)/, "");
  return [ctrl && "Ctrl", shift && "Shift", alt && "Alt", meta && "Meta", key].filter(Boolean).join("+");
};

/** The command's first key (else its first shown key) as a menu shows it; undefined when it has none. */
export const formatKeys = (command: Pick<Command, "keys" | "shownKeys">): string | undefined => {
  const first = command.keys?.[0] ?? command.shownKeys?.[0];
  return first === undefined ? undefined : chordLabel(parseKeys(first));
};

type Registered = { command: Command; chords: KeyChord[] };

const registered = new Map<string, Registered>();

/** Whether a key is held with ctrl, alt or meta, which typing never does; shift types. */
const isModified = ({ ctrl, alt, meta }: Pick<KeyChord, "ctrl" | "alt" | "meta">): boolean => ctrl || alt || meta;

/** Whether binding `chord` without a scope would run it while typing: it isn't modified and isn't a function key. */
const isPlain = (chord: KeyChord): boolean => !isModified(chord) && !/^F\d+$/.test(chord.code);

/** Whether `event` isn't modified (`isModified`); a function key counts, as an editable element may take it. */
const isTypedKey = (event: KeyboardEvent): boolean => !isModified({ ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey });

/**
 * Registers `command`; returns its unregistration. Its keys are parsed now, so a key string that doesn't parse fails
 * here, not at the first key press. An id that's already registered is refused, and so is a plain key (`isPlain`) on a
 * command without a scope.
 */
export const registerCommand = (command: Command): (() => void) => {
  if (registered.has(command.id)) throw new Error(`The command "${command.id}" is already registered; unregister it first or pick another id.`);
  const chords = (command.keys ?? []).map(parseKeys);
  const plain = command.scope === undefined ? command.keys?.find((key) => isPlain(parseKeys(key))) : undefined;
  if (plain !== undefined) {
    throw new Error(`The command "${command.id}" binds the plain key "${plain}" without a scope; a key without ctrl, alt or meta (other than a function key) would run while typing, so give the command a scope or add a modifier.`);
  }
  const entry = { command, chords };
  registered.set(command.id, entry);
  return () => {
    if (registered.get(command.id) === entry) registered.delete(command.id);
  };
};

/** Every registered command, in the order they were registered. */
export const commands = (): Command[] => [...registered.values()].map(({ command }) => command);

/** Runs command `id` on `target`; rejects, naming the id, when no such command is registered. */
export const runCommand = async (id: string, target: CommandTarget = {}): Promise<void> => {
  const entry = registered.get(id);
  if (entry === undefined) throw new Error(`There's no command "${id}"; check the id against the registered commands.`);
  await entry.command.run(target);
};

/** Runs command `id` from a click; a failure (an unknown id too) is logged, as for a key, since a click has nowhere to reject to. */
export const runLogged = (id: string, target?: CommandTarget): void => {
  runCommand(id, target).catch((error: unknown) => console.error(`The command "${id}" failed:`, error));
};

/** The structural shape of an event target commandForKey reads: no DOM classes, so it runs in node too. */
type KeyTarget = { tagName?: unknown; isContentEditable?: unknown; closest?: unknown };

const closestOf = (target: unknown, selector: string): unknown => {
  if (typeof target !== "object" || target === null) return null;
  const { closest } = target as KeyTarget;
  return typeof closest === "function" ? ((closest as (selector: string) => unknown).call(target, selector) ?? null) : null;
};

/** Whether typing in `target` is the user's text: an input, textarea, select, contenteditable or Monaco. */
const isEditable = (target: unknown): boolean => {
  if (typeof target !== "object" || target === null) return false;
  const { tagName, isContentEditable } = target as KeyTarget;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || isContentEditable === true) return true;
  return closestOf(target, ".monaco-editor") !== null;
};

/** Whether `target` acts on a plain key itself (a button or a link: Enter and Space press it). */
const pressesItself = (target: unknown): boolean => {
  if (typeof target !== "object" || target === null) return false;
  const { tagName } = target as KeyTarget;
  return tagName === "BUTTON" || tagName === "A";
};

type ScopeHandler = (element: Element, target: CommandTarget) => void | Promise<void>;
type ScopeHandlers = Partial<Record<string, ScopeHandler>>;

const scopeRoots = new WeakMap<object, ScopeHandlers>();

const SCOPE_ATTRIBUTE = "data-command-scope";

/** The handler for command `id` of the nearest root of `scope` holding `element`; undefined when it has none. */
const scopeHandler = (scope: string, id: string, element: unknown): ScopeHandler | undefined => {
  const root = closestOf(element, `[${SCOPE_ATTRIBUTE}="${scope}"]`);
  return typeof root === "object" && root !== null ? scopeRoots.get(root)?.[id] : undefined;
};

/**
 * Marks the element it's spread on as a root of `scope`, whose `handlers` (by command id) run the scope's commands on
 * an element inside it. The handlers are attached when React sets the ref, not in an effect.
 */
export const useCommandScope = (scope: string, handlers: ScopeHandlers): { ref: (element: Element | null) => (() => void) | undefined; [SCOPE_ATTRIBUTE]: string } => {
  const ref = useCallback(
    (element: Element | null) => {
      if (element === null) return undefined;
      scopeRoots.set(element, handlers);
      return () => {
        if (scopeRoots.get(element) === handlers) scopeRoots.delete(element);
      };
    },
    [handlers],
  );
  return { ref, [SCOPE_ATTRIBUTE]: scope };
};

/** A scoped command's `run`: runs command `id`'s handler of the nearest root of `scope` on the target's element, with the target; nothing without one. */
export const runInScope =
  (scope: string, id: string) =>
  async (target: CommandTarget): Promise<void> => {
    const { element } = target;
    if (element !== undefined) await scopeHandler(scope, id, element)?.(element, target);
  };

const matches = (chord: KeyChord, event: KeyboardEvent): boolean =>
  chord.code === event.code && chord.ctrl === event.ctrlKey && chord.shift === event.shiftKey && chord.alt === event.altKey && chord.meta === event.metaKey;

/** Whether a scoped `command` takes `event`'s key: its target is inside a root of the scope with a handler for it, and a plain key isn't the target's own. */
const takesInScope = ({ id, scope }: Command, event: KeyboardEvent): boolean => {
  if (scope === undefined) return true;
  if (isTypedKey(event) && pressesItself(event.target)) return false;
  return scopeHandler(scope, id, event.target) !== undefined;
};

/**
 * The command a keydown runs, if any, and for a scoped command the element it runs on (the event's target): the latest
 * registered one with a matching key whose `when` holds, and whose scope, if it has one, takes the key there. In an
 * editable element only ctrl+, alt+ and meta+ chords reach a command; plain and shift+ keys stay the element's.
 */
export const commandForKey = (event: KeyboardEvent): { command: Command; element?: Element } | undefined => {
  if (event.isComposing) return undefined;
  if (isTypedKey(event) && isEditable(event.target)) return undefined;
  const entries = [...registered.values()].reverse();
  const found = entries.find(
    ({ command, chords }) => chords.some((chord) => matches(chord, event)) && takesInScope(command, event) && (command.when?.() ?? true),
  )?.command;
  if (found === undefined) return undefined;
  return found.scope === undefined ? { command: found } : { command: found, element: event.target as Element };
};

const MAIN_COMMAND_TITLES: Record<MainCommandId, string> = {
  "zoom.in": "Zoom In",
  "zoom.out": "Zoom Out",
  "zoom.reset": "Reset Zoom",
  "edit.undo": "Undo",
  "edit.redo": "Redo",
  "edit.cut": "Cut",
  "edit.copy": "Copy",
  "edit.paste": "Paste",
  "edit.selectAll": "Select All",
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.close": "Close Window",
  "service.stop": "Stop Service and Agents",
  "app.quit": "Quit",
};

// VS Code's Linux defaults. The edit commands have none (see MAIN_COMMAND_SHOWN_KEYS).
const MAIN_COMMAND_KEYS: Partial<Record<MainCommandId, readonly string[]>> = {
  "zoom.in": ["ctrl+=", "ctrl+shift+=", "ctrl+numpad_add"],
  "zoom.out": ["ctrl+-", "ctrl+numpad_subtract"],
  "zoom.reset": ["ctrl+numpad0"],
  "window.close": ["ctrl+shift+w"],
  "app.quit": ["ctrl+q"],
};

// What VS Code's Edit menu shows on Linux.
const MAIN_COMMAND_SHOWN_KEYS: Partial<Record<MainCommandId, readonly string[]>> = {
  "edit.undo": ["ctrl+z"],
  "edit.redo": ["ctrl+shift+z"],
  "edit.cut": ["ctrl+x"],
  "edit.copy": ["ctrl+c"],
  "edit.paste": ["ctrl+v"],
  "edit.selectAll": ["ctrl+a"],
};

for (const id of MAIN_COMMAND_IDS) {
  const keys = MAIN_COMMAND_KEYS[id];
  const shownKeys = MAIN_COMMAND_SHOWN_KEYS[id];
  registerCommand({ id, title: MAIN_COMMAND_TITLES[id], ...(keys === undefined ? {} : { keys }), ...(shownKeys === undefined ? {} : { shownKeys }), run: () => window.wombat.command(id) });
}
