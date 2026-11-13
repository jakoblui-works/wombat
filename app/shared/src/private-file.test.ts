// Private files: the discovery file, the start lock and the store must never be readable by another
// local user, nor their folder listable; and a reader (the app, a racing start) must never see a half-written file.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { expect, onTestFinished, test } from "vitest";

import { createPrivateFile, ensurePrivateFile, writePrivateFile } from "./private-file.ts";

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

/** A fresh `<tmp>/private` folder path that doesn't exist yet. */
const tempDir = () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-private-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return join(base, "private");
};

test.each([
  { what: "into a new folder", existing: false },
  { what: "over a looser existing folder and file", existing: true },
])("writePrivateFile $what leaves the folder 0700 and the file 0600, with no temp file beside it", ({ existing }) => {
  const dir = tempDir();
  const path = join(dir, "file.json");
  if (existing) {
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    writeFileSync(path, "old");
    chmodSync(path, 0o644);
  }
  writePrivateFile(path, "new");
  expect(mode(dir)).toBe("700");
  expect(mode(path)).toBe("600");
  expect(readFileSync(path, "utf8")).toBe("new");
  expect(readdirSync(dir)).toEqual(["file.json"]);
});

test("ensurePrivateFile creates a missing file 0600 and tightens an existing one without touching its content", () => {
  const dir = tempDir();
  const fresh = join(dir, "fresh.db");
  ensurePrivateFile(fresh);
  expect(mode(dir)).toBe("700");
  expect(mode(fresh)).toBe("600");
  expect(readFileSync(fresh, "utf8")).toBe("");

  const kept = join(dir, "kept.db");
  writeFileSync(kept, "history");
  chmodSync(kept, 0o644);
  ensurePrivateFile(kept);
  expect(mode(kept)).toBe("600");
  expect(readFileSync(kept, "utf8")).toBe("history");
});

test("createPrivateFile creates the file 0600 once and refuses one that exists, leaving it as it was", () => {
  const dir = tempDir();
  const path = join(dir, "service.lock");
  createPrivateFile(path, "first\n");
  expect(mode(path)).toBe("600");
  expect(() => createPrivateFile(path, "second\n")).toThrow(expect.objectContaining({ code: "EEXIST" }));
  expect(readFileSync(path, "utf8")).toBe("first\n");
  expect(readdirSync(dir)).toEqual(["service.lock"]);
});

// A reader on another thread reads the file in a loop while this thread replaces it again and again with one of
// two large contents: every read must be one of them whole.
const READER = `
const { readFileSync } = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const { path, sizes, stop } = workerData;
const flag = new Int32Array(stop);
let reads = 0;
const torn = [];
while (Atomics.load(flag, 0) === 0) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    torn.push("unreadable");
    continue;
  }
  reads += 1;
  if (!sizes.includes(text.length) || text !== text[0].repeat(text.length)) torn.push(text.length);
}
parentPort.postMessage({ reads, torn: torn.slice(0, 5) });
`;

test("writePrivateFile replaces atomically: a concurrent reader only ever sees a whole old or new file", async () => {
  const dir = tempDir();
  const path = join(dir, "file.json");
  const contents = ["a".repeat(2_000_000), "b".repeat(3_000_000)];
  writePrivateFile(path, contents[0] ?? "");

  const stop = new SharedArrayBuffer(4);
  const worker = new Worker(READER, {
    eval: true,
    workerData: { path, sizes: contents.map((text) => text.length), stop },
  });
  onTestFinished(async () => {
    await worker.terminate();
  });
  const result = new Promise<{ reads: number; torn: unknown[] }>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  await new Promise((resolve) => worker.once("online", resolve));

  for (let round = 0; round < 60; round += 1) writePrivateFile(path, contents[round % 2] ?? "");
  Atomics.store(new Int32Array(stop), 0, 1);

  const { reads, torn } = await result;
  expect(reads, "the reader read the file while it was being replaced").toBeGreaterThan(0);
  expect(torn, "reads that saw a partial or missing file").toEqual([]);
});
