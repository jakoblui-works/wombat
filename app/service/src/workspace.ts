import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { RepoErrorCode } from "@wombat/shared/api";

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

/** The workspace root's real path; a `RepoError` when it doesn't exist. */
const realRoot = (workspaceRoot: string): string => {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    throw new RepoError(
      RepoErrorCode.enum.repo_not_found,
      `The workspace root ${workspaceRoot} doesn't exist. Check the service's workspace setting.`,
    );
  }
};

/**
 * The real path of `repo` (relative to the workspace root, `"."` for the root itself), after following every
 * symlink. Throws a `RepoError` when it isn't a folder, or resolves outside the root's real path.
 */
export const resolveRepo = (workspaceRoot: string, repo: string): string => {
  const rootReal = realRoot(workspaceRoot);
  let real: string;
  try {
    real = realpathSync(join(rootReal, repo));
  } catch {
    throw new RepoError(
      RepoErrorCode.enum.repo_not_found,
      `There's no folder "${repo}" in the workspace. Give a repo path relative to the workspace root.`,
    );
  }
  if (!isWithin(rootReal, real)) {
    throw new RepoError(
      RepoErrorCode.enum.repo_outside_workspace,
      `The repo "${repo}" leads outside the workspace (through a symlink). Choose a folder inside the workspace.`,
    );
  }
  if (!statSync(real).isDirectory()) {
    throw new RepoError(
      RepoErrorCode.enum.repo_not_found,
      `"${repo}" in the workspace is a file, not a folder. Give the path of a repo folder.`,
    );
  }
  return real;
};

/** A folder an agent may start in: its path relative to the workspace root (`"."` for the root) and its name. */
export type WorkspaceRepo = { path: string; name: string };

/**
 * The folders an agent may start in: the workspace root first (named after its folder), then the root's immediate
 * subdirectories holding a `.git`, sorted by name. Hidden directories and symlinks (a link to a repo inside would
 * list it twice, one to outside leads out) are left out, so every path listed is one `resolveRepo` accepts.
 */
export const listRepos = (workspaceRoot: string): WorkspaceRepo[] => {
  realRoot(workspaceRoot);
  const root = resolve(workspaceRoot);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(root, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [{ path: ".", name: basename(root) }, ...names.map((name) => ({ path: name, name }))];
};
