// A harness's desktop module is reached only through the footer slots. It is imported in
// exactly one place, outside the panels (where panels are registered), and no panel imports from harnesses/ itself, so
// the generic footer and dialogs never hold a tool's own UI.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { expect, test } from "vitest";

const RENDERER = resolve(import.meta.dirname, "../src/renderer/src");
const HARNESSES = join(RENDERER, "harnesses");
const PANELS = join(RENDERER, "workbench", "panels");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** The files under harnesses/ that `file` imports (relative or `@/` specifiers). */
const harnessImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].flatMap(([, specifier = ""]) => {
    const target = specifier.startsWith("@/") ? join(RENDERER, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : undefined;
    return target !== undefined && !relative(HARNESSES, target).startsWith("..") ? [relative(HARNESSES, target)] : [];
  });

test("harness modules are imported once, outside the panels, and never by a panel", () => {
  const importers = sources(RENDERER)
    .filter((file) => relative(HARNESSES, file).startsWith(".."))
    .filter((file) => harnessImports(file).length > 0)
    .map((file) => relative(RENDERER, file));

  expect(importers.filter((file) => !relative(PANELS, join(RENDERER, file)).startsWith("..")), "panels importing harnesses/").toEqual([]);
  expect(importers, "the one registration point").toHaveLength(1);
});
