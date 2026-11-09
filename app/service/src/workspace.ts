import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export type RepoErrorCode = "repo_not_found" | "repo_outside_workspace";

/** A repo path that doesn't name a folder inside the workspace. */
export class RepoError extends Error {
  readonly code: RepoErrorCode;

  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

/** True when `path` is `root` or inside it; both real paths. A plain prefix check would let `ws-evil` pass for `ws`. */
const isWithin = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * The real path of `repo` (relative to the workspace root, `"."` for the root itself), after following every
 * symlink. Throws a `RepoError` when it isn't a folder, or resolves outside the root's real path.
 */
export const resolveRepo = (workspaceRoot: string, repo: string): string => {
  let rootReal: string;
  try {
    rootReal = realpathSync(workspaceRoot);
  } catch {
    throw new RepoError(
      "repo_not_found",
      `The workspace root ${workspaceRoot} doesn't exist. Check the service's workspace setting.`,
    );
  }
  let real: string;
  try {
    real = realpathSync(join(rootReal, repo));
  } catch {
    throw new RepoError(
      "repo_not_found",
      `There's no folder "${repo}" in the workspace. Give a repo path relative to the workspace root.`,
    );
  }
  if (!isWithin(rootReal, real)) {
    throw new RepoError(
      "repo_outside_workspace",
      `The repo "${repo}" leads outside the workspace (through a symlink). Choose a folder inside the workspace.`,
    );
  }
  if (!statSync(real).isDirectory()) {
    throw new RepoError(
      "repo_not_found",
      `"${repo}" in the workspace is a file, not a folder. Give the path of a repo folder.`,
    );
  }
  return real;
};
