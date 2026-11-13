// Which code a service runs (contract "Service identity"): codeIdOf is the one function both the service (on the
// checkout it was started from) and main (on the checkout it starts the service from) hash the source with, and
// isStale is the one rule main reads a running service's /version by. Each test builds a small invented app tree.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { codeIdOf, isStale } from "./code-id.ts";

const CODE_ID_MODULE = path.join(import.meta.dirname, "code-id.ts");
const APP_ROOT = path.join(import.meta.dirname, "..", "..");

/** An invented app tree: what the id covers, and files beside it that it must not. */
const FILES: Record<string, string> = {
  "service/src/main.ts": 'export const main = () => "start";\n',
  "service/src/server/server.ts": 'export const route = "/version";\n',
  "service/src/server/server.test.ts": 'test("route", () => undefined);\n',
  "service/src/notes.md": "Service notes.\n",
  "service/test/fake-agent.ts": "export const fake = 1;\n",
  "service/package.json": '{ "name": "@wombat/service" }\n',
  "shared/src/api.ts": "export const API = 1;\n",
  "shared/src/api.test.ts": 'test("api", () => undefined);\n',
  "desktop/src/main/index.ts": "export const window = 1;\n",
};

const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "wombat-code-id-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** Writes FILES under a fresh root, in the given order (the order a folder lists its files in may follow it). */
const appTree = (order: "forward" | "reverse" = "forward"): string => {
  const root = tempDir();
  const entries = Object.entries(FILES);
  for (const [file, content] of order === "forward" ? entries : entries.reverse()) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
};

const write = (root: string, file: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};

/** codeIdOf run in a node process of its own, as the service and the app each run it. */
const codeIdInAnotherProcess = (root: string): string =>
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import { codeIdOf } from ${JSON.stringify(CODE_ID_MODULE)}; process.stdout.write(codeIdOf(${JSON.stringify(root)}));`],
    { encoding: "utf8" },
  );

test("codeIdOf is 16 hex characters, and the same files give the same id in another process and in another folder", () => {
  const root = appTree();
  const id = codeIdOf(root);
  expect(id).toMatch(/^[0-9a-f]{16}$/);
  expect(codeIdOf(root), "a second call").toBe(id);
  expect(codeIdInAnotherProcess(root), "another process").toBe(id);
  // The same files written in the other order, somewhere else: the service may run from a checkout at another path.
  expect(codeIdOf(appTree("reverse")), "the same files in another folder").toBe(id);
  // Touching a file changes its time, not its content.
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(root, "service/src/main.ts"), later, later);
  expect(codeIdOf(root), "a file's time changed").toBe(id);

  // The real app: an id, the same twice.
  const real = codeIdOf(APP_ROOT);
  expect(real).toMatch(/^[0-9a-f]{16}$/);
  expect(codeIdOf(APP_ROOT)).toBe(real);
});

test.each<[string, (root: string) => void]>([
  ["a service source file's content", (root) => write(root, "service/src/main.ts", 'export const main = () => "started";\n')],
  ["a new service source file", (root) => write(root, "service/src/agents/manager.ts", "export const manager = 1;\n")],
  ["a source file renamed, its content the same", (root) => renameSync(path.join(root, "shared/src/api.ts"), path.join(root, "shared/src/api-v1.ts"))],
])("codeIdOf changes with %s", (_name, change) => {
  const root = appTree();
  const before = codeIdOf(root);
  change(root);
  expect(codeIdOf(root)).not.toBe(before);
});

test.each<[string, (root: string) => void]>([
  ["a service test file's content", (root) => write(root, "service/src/server/server.test.ts", 'test("route", () => "changed");\n')],
  ["a file in src that isn't .ts", (root) => write(root, "service/src/notes.md", "Other notes.\n")],
  ["the desktop app's source", (root) => write(root, "desktop/src/main/index.ts", "export const window = 2;\n")],
])("codeIdOf stays the same when only %s changes", (_name, change) => {
  const root = appTree();
  const before = codeIdOf(root);
  change(root);
  expect(codeIdOf(root)).toBe(before);
});

test("isStale: a service without a codeId (from before it was reported) or with another one is stale; the same one isn't", () => {
  const onDisk = "0123456789abcdef";
  expect(isStale({ apiVersion: 1 }, onDisk), "an answer without codeId").toBe(true);
  expect(isStale({ apiVersion: 1, startedAt: "2026-11-12T07:34:00.000Z", codeId: "fedcba9876543210" }, onDisk), "another codeId").toBe(true);
  expect(isStale({ apiVersion: 1, startedAt: "2026-11-12T07:34:00.000Z", codeId: onDisk }, onDisk), "the same codeId").toBe(false);
});
