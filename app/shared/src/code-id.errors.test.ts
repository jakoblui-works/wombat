// codeIdOf where the tree isn't whole: a missing source folder, or a file that can't be read for any other reason
// than being gone, fails, naming it (the service turns that into a start refused).
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { codeIdOf } from "./code-id.ts";

const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "wombat-code-id-errors-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
};

test("a tree without shared/src fails, naming the folder", () => {
  const root = tree({ "service/src/main.ts": "export const main = 1;\n" });
  expect(() => codeIdOf(root)).toThrow(path.join(root, "shared/src"));
});

test.skipIf(process.getuid?.() === 0)("a source file that can't be read fails, naming it", () => {
  const root = tree({ "service/src/main.ts": "export const main = 1;\n", "shared/src/api.ts": "export const api = 1;\n" });
  chmodSync(path.join(root, "service/src/main.ts"), 0o000);
  expect(() => codeIdOf(root)).toThrow(path.join(root, "service/src/main.ts"));
});
