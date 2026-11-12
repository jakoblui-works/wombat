import { simpleGit } from "simple-git";

/**
 * The current local branch of the git repo `dir` is in; undefined when `dir` isn't in one, on a detached HEAD, and
 * on a branch with no commits yet. Throws when git fails otherwise.
 */
export const readBranch = async (dir: string): Promise<string | undefined> => {
  const git = simpleGit(dir);
  if (!(await git.checkIsRepo())) return undefined;
  const { current, detached } = await git.branchLocal();
  return detached || current === "" ? undefined : current;
};
