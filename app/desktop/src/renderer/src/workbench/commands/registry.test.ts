// Typing in an editable element reaches a command only through ctrl+, alt+ and meta+ chords: a plain key bound to a command
// must never fire while the user types. The commands here are the test's own (ids "test.*").
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { commandForKey, registerCommand, useCommandScope } from "./registry.ts";

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

const idFor = (event: KeyboardEvent): string | undefined => commandForKey(event)?.command.id;

const noop = (): undefined => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

test("in an input, textarea, select, contenteditable or Monaco a plain key reaches no command, while ctrl+, alt+ and meta+ chords still do", () => {
  registerCommand({ id: "test.editable.plain", title: "Plain key", keys: ["f7"], run: noop });
  registerCommand({ id: "test.editable.shift", title: "Shift key", keys: ["shift+f7"], run: noop });
  registerCommand({ id: "test.editable.ctrl", title: "Ctrl chord", keys: ["ctrl+f6"], run: noop });
  registerCommand({ id: "test.editable.alt", title: "Alt chord", keys: ["alt+f6"], run: noop });
  registerCommand({ id: "test.editable.meta", title: "Meta chord", keys: ["meta+f6"], run: noop });

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
    expect(idFor(keydown("F6", "F6", { meta: true, target })), `a meta chord in ${what}`).toBe("test.editable.meta");
  }
});

/** An element under `parent` that knows only its scope-root ancestors: `closest` answers `[data-command-scope="x"]`. */
type Nested = Target & { scope: string | undefined; parent: Nested | undefined };
const nested = (tagName: string, parent: Nested | undefined, { scope, editable = false }: { scope?: string; editable?: boolean } = {}): Nested => {
  const node: Nested = {
    tagName,
    isContentEditable: editable,
    scope,
    parent,
    closest: (selector: string) => {
      const wanted = /^\[data-command-scope="(.*)"\]$/.exec(selector)?.[1];
      for (let at: Nested | undefined = node; at !== undefined; at = at.parent) if (wanted !== undefined && at.scope === wanted) return at;
      return null;
    },
  };
  return node;
};

/** Marks `root` as a root of `scope` with `handlers` the way a component does: the hook's ref, set to the element. */
const markRoot = (root: Nested, scope: string, handlers: Partial<Record<string, (element: Element) => void>>): void => {
  let marked: ReturnType<typeof useCommandScope> | undefined;
  const Probe = (): null => {
    marked = useCommandScope(scope, handlers);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (marked === undefined) throw new Error("useCommandScope returned nothing");
  root.scope = marked["data-command-scope"];
  marked.ref(root as unknown as Element);
};

test("a plain key never runs a command while typing, outside its scope, on a button, or where its root has no handler; an unscoped plain key can't be registered", () => {
  const SCOPE = "test.rows";
  registerCommand({ id: "test.scope.preview", title: "Preview", keys: ["space"], scope: SCOPE, run: noop });
  registerCommand({ id: "test.scope.open", title: "Open", keys: ["enter"], scope: SCOPE, run: noop });
  registerCommand({ id: "test.scope.letter", title: "Letter", keys: ["x"], scope: SCOPE, run: noop });
  const handlers = { "test.scope.preview": noop, "test.scope.open": noop };

  const body = nested("BODY", undefined);
  const root = nested("DIV", nested("ASIDE", body));
  markRoot(root, SCOPE, handlers);
  // Another scope's root with handlers for the same ids: only a root of the command's own scope counts.
  const otherRoot = nested("DIV", body);
  markRoot(otherRoot, "test.other", handlers);
  const row = nested("DIV", root);

  const cases: [string, KeyboardEvent, string | undefined][] = [
    ["space on a row", keydown(" ", "Space", { target: row }), "test.scope.preview"],
    ["space inside a row", keydown(" ", "Space", { target: nested("SPAN", row) }), "test.scope.preview"],
    ["enter on a row", keydown("Enter", "Enter", { target: row }), "test.scope.open"],
    ["space in an input in the root", keydown(" ", "Space", { target: nested("INPUT", root) }), undefined],
    ["a letter in a contenteditable in the root", keydown("x", "KeyX", { target: nested("DIV", root, { editable: true }) }), undefined],
    ["enter on a button in the root", keydown("Enter", "Enter", { target: nested("BUTTON", row) }), undefined],
    ["space on a link in the root", keydown(" ", "Space", { target: nested("A", row) }), undefined],
    ["space outside any root", keydown(" ", "Space", { target: nested("DIV", body) }), undefined],
    ["space in another scope's root", keydown(" ", "Space", { target: nested("DIV", otherRoot) }), undefined],
    ["a letter whose root has no handler for it", keydown("x", "KeyX", { target: row }), undefined],
  ];
  for (const [what, event, expected] of cases) {
    const found = commandForKey(event);
    expect(found?.command.id, what).toBe(expected);
    if (expected !== undefined) expect(found?.element, `the element ${what} runs on`).toBe(event.target);
  }

  for (const key of ["space", "enter", "x", "shift+x"]) {
    expect(() => registerCommand({ id: `test.unscoped.${key}`, title: "Plain", keys: [key], run: noop }), `"${key}" without a scope`).toThrow();
  }
  for (const key of ["f9", "shift+f9", "ctrl+x", "alt+x", "meta+x"]) {
    expect(() => registerCommand({ id: `test.unscoped.${key}`, title: "Chord", keys: [key], run: noop }), `"${key}" without a scope`).not.toThrow();
  }
  expect(() => registerCommand({ id: "test.scoped.y", title: "Scoped", keys: ["y"], scope: SCOPE, run: noop }), "a plain key with a scope").not.toThrow();
});
