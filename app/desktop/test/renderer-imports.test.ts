// Who may import whom in the renderer, and who may open or close a tab, read from the real files.
// A harness's desktop module is reached only through the footer slots. It is imported in
// exactly one place, outside the panels (where panels are registered), and no panel imports from harnesses/ itself, so
// the generic footer and dialogs never hold a tool's own UI.
// The Desk's and the Item's panel folders never import from each other, and no shell or topic file imports from a
// panel's folder.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { expect, test } from "vitest";

const RENDERER = resolve(import.meta.dirname, "../src/renderer/src");
const HARNESSES = join(RENDERER, "harnesses");
const WORKBENCH = join(RENDERER, "workbench");
const PANELS = join(WORKBENCH, "panels");

const isTest = (name: string): boolean => /\.test\.tsx?$/.test(name);

const allSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allSources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const sources = (dir: string): string[] => allSources(dir).filter((file) => !isTest(file));

const within = (dir: string, path: string): boolean => !relative(dir, path).startsWith("..");

/**
 * The paths `file` imports through relative or `@/` specifiers: static imports, `import type`, re-exports and
 * dynamic `import()`.
 */
const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].flatMap(([, specifier = ""]) => {
    const target = specifier.startsWith("@/") ? join(RENDERER, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : undefined;
    return target === undefined ? [] : [target];
  });

/** The files under harnesses/ that `file` imports. */
const harnessImports = (file: string): string[] =>
  imports(file)
    .filter((target) => within(HARNESSES, target))
    .map((target) => relative(HARNESSES, target));

/** "a imports b" for each import of a file under `to` by one of `files`, paths from workbench/. */
const importsInto = (files: string[], to: string): string[] =>
  files.flatMap((file) =>
    imports(file)
      .filter((target) => within(to, target))
      .map((target) => `${relative(WORKBENCH, file)} imports ${relative(WORKBENCH, target)}`),
  );

test("harness modules are imported once, outside the panels, and never by a panel", () => {
  const importers = sources(RENDERER)
    .filter((file) => relative(HARNESSES, file).startsWith(".."))
    .filter((file) => harnessImports(file).length > 0)
    .map((file) => relative(RENDERER, file));

  expect(importers.filter((file) => !relative(PANELS, join(RENDERER, file)).startsWith("..")), "panels importing harnesses/").toEqual([]);
  expect(importers, "the one registration point").toHaveLength(1);
});

test("the Desk's and the Item's panel folders never import from each other, tests included", () => {
  const desk = join(PANELS, "Desk");
  const item = join(PANELS, "Item");
  expect(
    [...importsInto(allSources(desk), item), ...importsInto(allSources(item), desk)],
    "A panel imports from another panel's folder. Move what both use to workbench/<topic>/ (items' code: workbench/items/) and import it from there.",
  ).toEqual([]);
});

test("outside panels/, only activities.ts imports from a panel's folder", () => {
  const outside = allSources(WORKBENCH).filter((file) => !within(PANELS, file) && file !== join(WORKBENCH, "activities.ts"));
  expect(
    importsInto(outside, PANELS),
    "A workbench file outside panels/ imports from a panel's folder. Panels are named only in activities.ts, where they're registered; move what the file needs to workbench/<topic>/ and import it from there.",
  ).toEqual([]);
});
