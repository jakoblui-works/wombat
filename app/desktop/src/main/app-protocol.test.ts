import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

import { contentType, isAppOrigin, resolveAppFile } from "./app-protocol.ts";

// A built renderer at <tmp>/out/renderer, with a file outside it that traversal would reach.
let base: string;
let root: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "wombat-app-protocol-"));
  root = path.join(base, "out", "renderer");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html>");
  await writeFile(path.join(root, "assets", "index.js"), "export {};");
  await writeFile(path.join(base, "package.json"), "{}");
  await writeFile(path.join(base, "out", "package.json"), "{}");
  await symlink(path.join(base, "package.json"), path.join(root, "linked.json"));
  await symlink(base, path.join(root, "linked-dir"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

test("serves files under the renderer root", async () => {
  expect(await resolveAppFile(root, "app://wombat/index.html")).toBe(path.join(root, "index.html"));
  expect(await resolveAppFile(root, "app://wombat/assets/index.js")).toBe(path.join(root, "assets", "index.js"));
});

test.each([
  "app://wombat/../../package.json",
  "app://wombat/../package.json",
  "app://wombat/%2e%2e/%2e%2e/package.json",
  "app://wombat/%2E%2E/package.json",
  "app://wombat/..%2f..%2fpackage.json",
  "app://wombat/%2e%2e%2f%2e%2e%2fpackage.json",
  "app://wombat/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json",
  "app://wombat/..%5c..%5cpackage.json",
])("rejects a path that escapes the root: %s", async (url) => {
  expect(await resolveAppFile(root, url)).toBeNull();
});

test("rejects symlinks that point outside the root", async () => {
  expect(await resolveAppFile(root, "app://wombat/linked.json")).toBeNull();
  expect(await resolveAppFile(root, "app://wombat/linked-dir/package.json")).toBeNull();
});

test("rejects other hosts, other schemes, directories, missing files and malformed escapes", async () => {
  for (const url of [
    "app://other/index.html",
    "file:///index.html",
    "app://wombat/assets",
    "app://wombat/",
    "app://wombat/missing.html",
    "app://wombat/%E0%A4%A",
  ]) {
    expect(await resolveAppFile(root, url), url).toBeNull();
  }
});

test("gives each served file its content type", () => {
  expect(contentType("index.html")).toBe("text/html; charset=utf-8");
  expect(contentType("assets/index-abc.js")).toBe("text/javascript; charset=utf-8");
  expect(contentType("assets/style.css")).toBe("text/css; charset=utf-8");
  expect(contentType("blob.bin")).toBe("application/octet-stream");
});

test.each([
  "app://wombat/",
  "app://wombat/index.html",
  "app://wombat/assets/index.js?v=1#top",
])("isAppOrigin accepts the app's own URL %s", (url) => {
  expect(isAppOrigin(url)).toBe(true);
});

test.each([
  "app://wombat.evil/",
  "app://evil.wombat/",
  "app://wombat:1/",
  "app://x@wombat/",
  "app://:pw@wombat/",
  "app://other/index.html",
  "https://wombat/",
  "file:///index.html",
  "wombat/index.html",
  "not a url",
])("isAppOrigin rejects lookalike or foreign URL %s", (url) => {
  expect(isAppOrigin(url)).toBe(false);
});
