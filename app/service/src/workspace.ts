import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { RepoErrorCode, WorkspaceErrorCode, type Workspace } from "@wombat/shared/api";

/** A repo path that doesn't name a folder inside the workspace. */
export class RepoError extends Error {
  readonly code: RepoErrorCode;

  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

/** A workspace id the list doesn't hold, or a workspace whose folder is gone. */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

/** The refusal of anything that needs the folder of a workspace whose folder is gone: a start, a resume, a repo list. */
export const workspaceMissing = (root: string) =>
  new WorkspaceError(
    WorkspaceErrorCode.enum.workspace_missing,
    `The workspace folder ${root} is gone (moved or deleted), so no agent can start or resume in it. Restore the folder at ${root}, then try again; its agents stay listed.`,
  );

/** The refusal of a workspace id the list doesn't hold. */
export const workspaceNotFound = (id: string) =>
  new WorkspaceError(
    WorkspaceErrorCode.enum.workspace_not_found,
    `There's no workspace ${id}. List the workspaces to see which exist, and add the folder first if it isn't there.`,
  );

/**
 * The refusal of a stored agent's repo that is gone or now leads outside its workspace, from `resolveRepo`'s `code`:
 * unlike a start, the agent can't be given another repo.
 */
export const agentRepoGone = (code: RepoErrorCode, root: string, repo: string) => {
  const folder = join(root, repo);
  const what =
    code === RepoErrorCode.enum.repo_outside_workspace
      ? `now leads outside the workspace folder ${root} (through a symlink)`
      : "is gone (moved or deleted) or no longer a folder";
  return new RepoError(code, `The agent's folder ${folder} ${what}. Restore the folder at ${folder}, then try again.`);
};

/**
 * The root of workspace `id` as `getWorkspace` holds it: `workspace_not_found` for an id it doesn't hold,
 * `workspace_missing` while the root isn't an existing folder.
 */
export const rootIn =
  (getWorkspace: (id: string) => Workspace | undefined) =>
  (id: string): string => {
    const workspace = getWorkspace(id);
    if (workspace === undefined) throw workspaceNotFound(id);
    if (workspace.missing) throw workspaceMissing(workspace.root);
    return workspace.root;
  };

/** True when `path` is `root` or inside it; both real paths. A plain prefix check would let `ws-evil` pass for `ws`. */
export const isWithin = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** The workspace root's real path; `workspace_missing` when it doesn't exist (it may go after `rootIn` saw it). */
const realRoot = (workspaceRoot: string): string => {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    throw workspaceMissing(workspaceRoot);
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
      `There's no folder "${repo}" in the workspace folder ${workspaceRoot}. Give a repo path relative to ${workspaceRoot}.`,
    );
  }
  if (!isWithin(rootReal, real)) {
    throw new RepoError(
      RepoErrorCode.enum.repo_outside_workspace,
      `The repo "${repo}" leads outside the workspace folder ${workspaceRoot} (through a symlink). Choose a folder inside ${workspaceRoot}.`,
    );
  }
  if (!statSync(real).isDirectory()) {
    throw new RepoError(
      RepoErrorCode.enum.repo_not_found,
      `"${repo}" in the workspace folder ${workspaceRoot} is a file, not a folder. Give the path of a repo folder in it.`,
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
