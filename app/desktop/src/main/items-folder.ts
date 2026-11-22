import { readdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow } from "electron";

const CHOOSE_ANOTHER = "Choose another folder for your items with Choose Items Folder… in the File menu.";

/** Why `folder` can't be the items root, from the error code reading it gave; undefined when it can. */
export const itemsFolderProblem = (folder: string, readError: string | undefined): string | undefined => {
  if (!path.isAbsolute(folder)) return `${folder} isn't an absolute path. ${CHOOSE_ANOTHER}`;
  if (readError === undefined) return undefined;
  if (readError === "ENOENT" || readError === "ENOTDIR") return `${folder} isn't an existing folder. ${CHOOSE_ANOTHER}`;
  return `Wombat can't read the folder ${folder} (${readError}). ${CHOOSE_ANOTHER}`;
};

/** Reads `folder`'s entries, as the service will; throws with itemsFolderProblem's message when it can't be the items root. */
export const checkItemsFolder = async (folder: string): Promise<void> => {
  let readError: string | undefined;
  if (path.isAbsolute(folder)) {
    try {
      await readdir(folder);
    } catch (error) {
      readError = (error as NodeJS.ErrnoException).code ?? String(error);
    }
  }
  const problem = itemsFolderProblem(folder, readError);
  if (problem !== undefined) throw new Error(problem);
};

export type ChooseItemsFolderDeps = {
  /** The open workspace; undefined before one is chosen. */
  workspace: () => string | undefined;
  itemsRoot: (workspace: string) => string | undefined;
  /** The folder picker, opening at `current`, modal to `parent`; undefined when it's cancelled. */
  pick: (current: string | undefined, parent: BrowserWindow | undefined) => Promise<string | undefined>;
  check?: (folder: string) => Promise<void>;
  /** Restart Service, running `beforeStop` once the user has agreed and before the stop. False when cancelled. */
  restartAfter: (beforeStop: () => void) => Promise<boolean>;
  saveItemsRoot: (workspace: string, folder: string) => void;
  report: (title: string, error: unknown) => void;
  log?: (line: string) => void;
};

/**
 * Choose Items Folder…: the picker, the folder check, then Restart Service with the folder saved as the workspace's
 * items root just before the stop. A cancel, a refused folder, a cancelled restart question or a workspace switched
 * meanwhile leaves the setting and the service as they were. Reports its own errors.
 */
export const itemsFolderChooser =
  ({ workspace, itemsRoot, pick, check = checkItemsFolder, restartAfter, saveItemsRoot, report, log = console.warn }: ChooseItemsFolderDeps) =>
  async (parent: BrowserWindow | undefined): Promise<void> => {
    const root = workspace();
    if (root === undefined) {
      report("Wombat can't choose an items folder yet", new Error("No workspace is open yet; choose one with Switch Workspace, then choose its items folder."));
      return;
    }
    let folder: string | undefined;
    try {
      folder = await pick(itemsRoot(root), parent);
      if (folder === undefined) return;
      await check(folder);
    } catch (error) {
      report("Wombat can't use that items folder", error);
      return;
    }
    if (workspace() !== root) {
      log(`The workspace changed while the items folder was being chosen, so ${folder} wasn't saved. Choose it again for this workspace.`);
      return;
    }
    const chosen = folder;
    try {
      await restartAfter(() => saveItemsRoot(root, chosen));
    } catch (error) {
      report("Wombat couldn't restart the service with the new items folder", error);
    }
  };
