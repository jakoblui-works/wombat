// S7 T12 (lasting, silent failure): the folders the New agent dialog offers come from one place, `listRepos`, and
// it offers only what an agent may start in: the workspace root, then the root's own git repos by name. A hidden
// folder, a folder that isn't a repo, a repo nested deeper and anything reached through a symlink are never offered,
// and every folder offered is one `resolveRepo` accepts.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { listRepos, resolveRepo } from "./workspace.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wombat-repos-"));
  made.push(dir);
  return dir;
};

/** A git repo as `listRepos` sees one: a folder holding `.git` (a folder, or a file as in a worktree). */
const repo = (at: string, gitAs: "dir" | "file" = "dir"): void => {
  mkdirSync(at, { recursive: true });
  if (gitAs === "dir") mkdirSync(join(at, ".git"));
  else writeFileSync(join(at, ".git"), "gitdir: ../.git/worktrees/elsewhere\n");
};

test("the root first, then the root's own git repos sorted by name; nothing hidden, non-repo, nested or symlinked", () => {
  const base = tempDir();
  const root = join(base, "bakery-workspace");
  mkdirSync(root);
  repo(join(root, "zeta-shop"));
  repo(join(root, "alpha-site"));
  repo(join(root, "menu-api"), "file");
  repo(join(root, ".hidden-repo"));
  mkdirSync(join(root, "notes"));
  repo(join(root, "notes", "nested-repo"));
  writeFileSync(join(root, "readme.md"), "not a folder\n");
  writeFileSync(join(root, "file-with-git"), "");
  // Symlinks: to a repo inside (would list it twice) and to a repo outside the workspace.
  symlinkSync(join(root, "alpha-site"), join(root, "alpha-link"));
  repo(join(base, "outside-repo"));
  symlinkSync(join(base, "outside-repo"), join(root, "outside-link"));

  const listed = listRepos(root);

  expect(listed).toEqual([
    { path: ".", name: basename(root) },
    { path: "alpha-site", name: "alpha-site" },
    { path: "menu-api", name: "menu-api" },
    { path: "zeta-shop", name: "zeta-shop" },
  ]);
  for (const { path } of listed) expect(() => resolveRepo(root, path), path).not.toThrow();
});

test("a workspace without repos offers the root alone", () => {
  const root = join(tempDir(), "empty-workspace");
  mkdirSync(join(root, "docs"), { recursive: true });

  expect(listRepos(root)).toEqual([{ path: ".", name: "empty-workspace" }]);
});
