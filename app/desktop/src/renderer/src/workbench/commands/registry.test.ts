// The command registry's key dispatch and its main commands (interface-S1, T1). commandForKey is the one place every
// key goes through: a key string matches its exact chord, `when` decides whether a command takes its key, and typing
// in an editable element reaches a command only through ctrl+/alt+ chords. Every main command is a registry command
// that sends its own id to main. The commands here are the test's own (ids "test.*", chords no default uses), so the
// app's default keys can change without touching this file.
import { afterEach, expect, test, vi } from "vitest";

import { MAIN_COMMAND_IDS } from "../../../../shared/bridge.ts";
import { commandForKey, commands, registerCommand, runCommand } from "./registry.ts";

type Target = { tagName: string; isContentEditable: boolean; closest: (selector: string) => unknown };

/** An element as commandForKey sees it: structurally, no DOM in these tests. */
const element = (tagName: string, { editable = false, inMonaco = false } = {}): Target => ({
  tagName,
  isContentEditable: editable,
  closest: (selector: string) => (inMonaco && selector.includes("monaco-editor") ? { className: "monaco-editor" } : null),
});
const BODY = element("BODY");

type Chord = { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean; target?: Target };

/** A keydown as the window's listener gets it. */
const keydown = (key: string, code: string, { ctrl = false, alt = false, shift = false, meta = false, target = BODY }: Chord = {}): KeyboardEvent =>
  ({
    type: "keydown",
    key,
    code,
    ctrlKey: ctrl,
    altKey: alt,
    shiftKey: shift,
    metaKey: meta,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  }) as unknown as KeyboardEvent;

const idFor = (event: KeyboardEvent): string | undefined => commandForKey(event)?.id;

const noop = (): undefined => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a key string matches its own chord only: exact modifiers, and a numpad key apart from the digit", () => {
  registerCommand({ id: "test.keys.f9", title: "F9 chord", keys: ["ctrl+alt+f9"], run: noop });
  registerCommand({ id: "test.keys.equal", title: "Equal chord", keys: ["ctrl+alt+="], run: noop });
  registerCommand({ id: "test.keys.numpad", title: "Numpad chord", keys: ["ctrl+alt+numpad7"], run: noop });
  registerCommand({ id: "test.keys.second", title: "Second binding", keys: ["ctrl+alt+f3", "ctrl+alt+f4"], run: noop });

  expect(idFor(keydown("F9", "F9", { ctrl: true, alt: true }))).toBe("test.keys.f9");
  expect(idFor(keydown("=", "Equal", { ctrl: true, alt: true }))).toBe("test.keys.equal");
  expect(idFor(keydown("7", "Numpad7", { ctrl: true, alt: true }))).toBe("test.keys.numpad");
  // Every key in `keys` binds, not only the first.
  expect(idFor(keydown("F3", "F3", { ctrl: true, alt: true }))).toBe("test.keys.second");
  expect(idFor(keydown("F4", "F4", { ctrl: true, alt: true }))).toBe("test.keys.second");

  const others: [string, KeyboardEvent][] = [
    ["a modifier missing", keydown("F9", "F9", { ctrl: true })],
    ["shift added", keydown("F9", "F9", { ctrl: true, alt: true, shift: true })],
    ["meta added", keydown("F9", "F9", { ctrl: true, alt: true, meta: true })],
    ["no modifiers", keydown("F9", "F9")],
    ["shift added to =", keydown("+", "Equal", { ctrl: true, alt: true, shift: true })],
    ["the bare =", keydown("=", "Equal")],
    ["the digit 7, not the numpad's", keydown("7", "Digit7", { ctrl: true, alt: true })],
    ["an unbound chord", keydown("F2", "F2", { ctrl: true, alt: true, shift: true, meta: true })],
  ];
  const matched = others.flatMap(([what, event]) => {
    const id = idFor(event);
    return id?.startsWith("test.keys.") ? [`${what} ran ${id}`] : [];
  });
  expect(matched).toEqual([]);
});

test("a command whose when() is false doesn't take its key, and doesn't hide another command bound to the same key", () => {
  let contextual = false;
  registerCommand({ id: "test.when.contextual", title: "Only in context", keys: ["ctrl+alt+f10"], when: () => contextual, run: noop });
  registerCommand({ id: "test.when.general", title: "Always", keys: ["ctrl+alt+f10"], run: noop });
  let alone = false;
  registerCommand({ id: "test.when.alone", title: "Alone", keys: ["ctrl+alt+f11"], when: () => alone, run: noop });

  expect(idFor(keydown("F10", "F10", { ctrl: true, alt: true }))).toBe("test.when.general");
  expect(idFor(keydown("F11", "F11", { ctrl: true, alt: true }))).toBeUndefined();

  // when() is asked at each key, not once at registration.
  alone = true;
  expect(idFor(keydown("F11", "F11", { ctrl: true, alt: true }))).toBe("test.when.alone");
  contextual = true;
  expect(["test.when.contextual", "test.when.general"]).toContain(idFor(keydown("F10", "F10", { ctrl: true, alt: true })));
});

test("in an input, textarea, select, contenteditable or Monaco a plain key reaches no command, while ctrl+ and alt+ chords still do", () => {
  registerCommand({ id: "test.editable.plain", title: "Plain key", keys: ["f7"], run: noop });
  registerCommand({ id: "test.editable.shift", title: "Shift key", keys: ["shift+f7"], run: noop });
  registerCommand({ id: "test.editable.ctrl", title: "Ctrl chord", keys: ["ctrl+f6"], run: noop });
  registerCommand({ id: "test.editable.alt", title: "Alt chord", keys: ["alt+f6"], run: noop });

  // Control: outside an editable element the plain keys run.
  expect(idFor(keydown("F7", "F7"))).toBe("test.editable.plain");
  expect(idFor(keydown("F7", "F7", { shift: true }))).toBe("test.editable.shift");

  const editables: [string, Target][] = [
    ["input", element("INPUT")],
    ["textarea", element("TEXTAREA")],
    ["select", element("SELECT")],
    ["contenteditable", element("DIV", { editable: true })],
    ["inside Monaco", element("DIV", { inMonaco: true })],
  ];
  for (const [what, target] of editables) {
    expect(idFor(keydown("F7", "F7", { target })), `a plain key in ${what}`).toBeUndefined();
    expect(idFor(keydown("F7", "F7", { shift: true, target })), `shift+key in ${what}`).toBeUndefined();
    expect(idFor(keydown("F6", "F6", { ctrl: true, target })), `a ctrl chord in ${what}`).toBe("test.editable.ctrl");
    expect(idFor(keydown("F6", "F6", { alt: true, target })), `an alt chord in ${what}`).toBe("test.editable.alt");
  }
});

test("every main command is a registry command, and running it sends exactly its own id to main", async () => {
  const sent: string[] = [];
  vi.stubGlobal("window", {
    wombat: {
      command: (id: string) => {
        sent.push(id);
        return Promise.resolve();
      },
    },
  });

  const registered = new Set(commands().map((command) => command.id));
  expect(MAIN_COMMAND_IDS.filter((id) => !registered.has(id)), "main commands missing from the registry").toEqual([]);

  for (const id of MAIN_COMMAND_IDS) {
    sent.length = 0;
    await runCommand(id);
    expect(sent, `running ${id}`).toEqual([id]);
  }
});
