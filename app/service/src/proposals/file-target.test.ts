// Reading the file a proposal targets: the text is the file's bytes exactly, under the version of those bytes, or a
// problem. A truncated or repaired text stored under a version would be written over the file by an approve. And a
// path that became a symlink loop: the write answers a conflict and nothing reads as written, so the proposal is
// settled either way and never stays in applying.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";
import { expect, onTestFinished, test } from "vitest";

import { versionOf, versionOfText } from "../items/files.ts";
import { readText, writeProposed, written } from "./file-target.ts";

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wombat-target-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** `length` bytes of valid UTF-8 ending in a multi-byte character, so a cut at the limit would split it. */
const textOfBytes = (length: number) => Buffer.concat([Buffer.alloc(length - 2, "a"), Buffer.from("é")]);

// [what, the file's bytes, the problem; undefined when it reads as text]
const files: [string, Buffer, string | undefined][] = [
  ["a file of exactly the limit", textOfBytes(MAX_PROPOSAL_BYTES), undefined],
  ["a file one byte over the limit", Buffer.concat([textOfBytes(MAX_PROPOSAL_BYTES), Buffer.from("\n")]), "too_large"],
  ["a byte order mark and CRLF line ends", Buffer.from("﻿# Install\r\n\r\nRun `pnpm install`.\r\n"), undefined],
  ["bytes that aren't UTF-8", Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]), "not_utf8"],
];

test.each(files)("reading %s gives its exact text under the version of its bytes, or the problem", async (_what, bytes, problem) => {
  const path = join(tempDir(), "install.md");
  writeFileSync(path, bytes);

  const read = await readText(path);

  if (problem !== undefined) {
    expect(read).toStrictEqual({ problem });
    return;
  }
  expect(read).toHaveProperty("version", versionOf(bytes));
  const text = read !== undefined && "text" in read ? read.text : "";
  expect(Buffer.from(text, "utf8").equals(bytes), "the text writes back to the same bytes").toBe(true);
});

test("reading what isn't a regular file answers without waiting: nothing there, a folder, a FIFO nobody writes to", async () => {
  const dir = tempDir();
  mkdirSync(join(dir, "docs"));
  execFileSync("mkfifo", [join(dir, "pipe")]);

  expect(await readText(join(dir, "missing.md"))).toBeUndefined();
  expect(await readText(join(dir, "docs"))).toStrictEqual({ problem: "not_file" });
  expect(await readText(join(dir, "pipe"))).toStrictEqual({ problem: "not_file" });
});

test.each([
  { what: "an edit's file", kind: "edit" as const, loop: "install.md" },
  { what: "a new file's folder", kind: "create" as const, loop: "docs" },
])("when $what became a symlink loop, the write ends in a conflict and nothing reads as written", async ({ kind, loop }) => {
  const dir = tempDir();
  // A link to itself.
  symlinkSync(loop, join(dir, loop));
  const path = kind === "edit" ? join(dir, loop) : join(dir, loop, "install.md");
  const text = "# Install\n\nRun `pnpm install`.\n";

  const applied = await writeProposed({ proposal: { path, kind, baseVersion: kind === "edit" ? versionOfText("# Install\n") : null }, content: { text } });

  expect(applied, "a conflict, with what the user reads").toStrictEqual({ problem: { message: expect.any(String) as string } });
  expect(await written(path, versionOfText(text))).toBe(false);
});
