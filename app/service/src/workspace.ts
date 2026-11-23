import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { repoName, RepoErrorCode, ROOT_REPO, WorkspaceErrorCode, type Workspace } from "@wombat/shared/api";

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

/** What went wrong when the workspace at `root` has no items folder, for the user and for its agents alike. */
export const noItemsFolder = (root: string) => `The workspace ${root} has no items folder, so it has no items to read or change.`;

/** The `items_not_configured` message the user gets for a workspace without an items folder. */
export const itemsNotConfigured = ({ name, root }: Pick<Workspace, "name" | "root">) =>
  `${noItemsFolder(root)} Show that workspace first (choose ${name} in the File menu's list of workspaces), ` +
  "then choose its items folder with File → Choose Items Folder…, and try again.";

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
 * Workspace `id` as `getWorkspace` holds it: `workspace_not_found` for an id it doesn't hold, `workspace_missing`
 * while the root isn't an existing folder.
 */
export const workspaceIn =
  (getWorkspace: (id: string) => Workspace | undefined) =>
  (id: string): Workspace => {
    const workspace = getWorkspace(id);
    if (workspace === undefined) throw workspaceNotFound(id);
    if (workspace.missing) throw workspaceMissing(workspace.root);
    return workspace;
  };

/** True when `path` is `root` or inside it; both real paths. A plain prefix check would let `ws-evil` pass for `ws`. */
export const isWithin = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** The workspace root's real path; `workspace_missing` when it doesn't exist (it may go after `workspaceIn` saw it). */
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
 * The folders an agent may start in: the workspace root first (named after the workspace), then the root's immediate
 * subdirectories holding a `.git`, sorted by name. Hidden directories and symlinks (a link to a repo inside would
 * list it twice, one to outside leads out) are left out, so every path listed is one `resolveRepo` accepts.
 */
export const listRepos = (workspace: Pick<Workspace, "root" | "name">): WorkspaceRepo[] => {
  realRoot(workspace.root);
  const root = resolve(workspace.root);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(root, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [ROOT_REPO, ...names].map((path) => ({ path, name: repoName(path, workspace) }));
};
