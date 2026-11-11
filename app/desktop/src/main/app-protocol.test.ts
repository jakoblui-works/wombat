import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_ORIGIN } from "@wombat/shared";
import { afterAll, beforeAll, expect, test } from "vitest";

import { contentType, isAppOrigin, isBridgeSender, resolveAppFile } from "./app-protocol.ts";

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
  expect(await resolveAppFile(root, `${APP_ORIGIN}/index.html`)).toBe(path.join(root, "index.html"));
  expect(await resolveAppFile(root, `${APP_ORIGIN}/assets/index.js`)).toBe(path.join(root, "assets", "index.js"));
});

test.each([
  `${APP_ORIGIN}/../../package.json`,
  `${APP_ORIGIN}/../package.json`,
  `${APP_ORIGIN}/%2e%2e/%2e%2e/package.json`,
  `${APP_ORIGIN}/%2E%2E/package.json`,
  `${APP_ORIGIN}/..%2f..%2fpackage.json`,
  `${APP_ORIGIN}/%2e%2e%2f%2e%2e%2fpackage.json`,
  `${APP_ORIGIN}/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json`,
  `${APP_ORIGIN}/..%5c..%5cpackage.json`,
])("rejects a path that escapes the root: %s", async (url) => {
  expect(await resolveAppFile(root, url)).toBeNull();
});

test("rejects symlinks that point outside the root", async () => {
  expect(await resolveAppFile(root, `${APP_ORIGIN}/linked.json`)).toBeNull();
  expect(await resolveAppFile(root, `${APP_ORIGIN}/linked-dir/package.json`)).toBeNull();
});

test("rejects other hosts, other schemes, directories, missing files and malformed escapes", async () => {
  for (const url of [
    "app://other/index.html",
    "file:///index.html",
    `${APP_ORIGIN}/assets`,
    `${APP_ORIGIN}/`,
    `${APP_ORIGIN}/missing.html`,
    `${APP_ORIGIN}/%E0%A4%A`,
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
  `${APP_ORIGIN}/`,
  `${APP_ORIGIN}/index.html`,
  `${APP_ORIGIN}/assets/index.js?v=1#top`,
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

test("only the app's own page may call the bridge; the dev server's origin only in a dev build", () => {
  const devUrl = "http://localhost:5173/";
  expect(isBridgeSender(`${APP_ORIGIN}/index.html`, undefined)).toBe(true);
  expect(isBridgeSender(null, undefined), "a call whose frame is gone").toBe(false);
  expect(isBridgeSender(undefined, undefined)).toBe(false);
  expect(isBridgeSender("https://example.com/", undefined)).toBe(false);
  expect(isBridgeSender("app://wombat.evil/index.html", undefined)).toBe(false);
  expect(isBridgeSender("http://localhost:5173/index.html", undefined), "the dev server in a built app").toBe(false);
  expect(isBridgeSender("http://localhost:5173/index.html", devUrl)).toBe(true);
  expect(isBridgeSender(`${APP_ORIGIN}/index.html`, devUrl), "app:// in a dev build, which loads from the dev server").toBe(false);
});
