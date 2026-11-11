// Reading an agent folder's branch: the local branch's name, and nothing outside a git repo or on a detached HEAD.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { git, gitRepo } from "../../test/manager-fixtures.ts";
import { tempDir } from "../../test/store-fixtures.ts";
import { readBranch } from "./branch.ts";

describe("readBranch", () => {
  test("names the current local branch, from the repo's root or a folder inside it", async () => {
    const repo = tempDir();
    gitRepo(repo, "main");
    git(repo, "switch", "--quiet", "--create", "feature/footer-imprint");
    const inside = join(repo, "src");
    mkdirSync(inside);

    expect(await readBranch(repo)).toBe("feature/footer-imprint");
    expect(await readBranch(inside)).toBe("feature/footer-imprint");
  });

  test("is undefined in a folder outside any git repo", async () => {
    expect(await readBranch(tempDir())).toBeUndefined();
  });

  test("is undefined on a detached HEAD", async () => {
    const repo = tempDir();
    gitRepo(repo, "main");
    git(repo, "switch", "--quiet", "--detach");

    expect(await readBranch(repo)).toBeUndefined();
  });
});
