// Typing in an editable element reaches a command only through ctrl+ and alt+ chords: a plain key bound to a command
// must never fire while the user types. The commands here are the test's own (ids "test.*").
import { afterEach, expect, test, vi } from "vitest";

import { commandForKey, registerCommand } from "./registry.ts";

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
