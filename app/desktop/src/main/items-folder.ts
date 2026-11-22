import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "@wombat/shared/api";
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

const UNLISTED =
  "The service lists no workspace with that id, so there's none to choose an items folder for. Choose it from the workspace's Desk, or with Choose Items Folder… in the File menu.";

export type ChooseItemsFolderDeps = {
  /** The workspace as the service lists it now (its items folder is where the picker opens); undefined when it isn't listed. */
  workspaceOf: (workspace: string) => Promise<Pick<Workspace, "itemsRoot"> | undefined>;
  /** The folder picker, opening at `current`, modal to `parent`; undefined when it's cancelled. */
  pick: (current: string | undefined, parent: BrowserWindow | undefined) => Promise<string | undefined>;
  check?: (folder: string) => Promise<void>;
  /** Gives the service `folder` as the workspace's items folder (PUT /workspaces/:ws/items-root). */
  setItemsRoot: (workspace: string, folder: string) => Promise<unknown>;
  report: (title: string, error: unknown) => void;
};

/**
 * Choose Items Folder… for workspace `workspace`: the picker, the folder check, then the service takes the folder at
 * once (no restart: its agents keep running). No picker opens for a workspace the service doesn't list. A cancel or a
 * refused folder leaves the items folder as it was. Reports its own errors.
 */
export const itemsFolderChooser =
  ({ workspaceOf, pick, check = checkItemsFolder, setItemsRoot, report }: ChooseItemsFolderDeps) =>
  async (workspace: string, parent: BrowserWindow | undefined): Promise<void> => {
    let listed: Pick<Workspace, "itemsRoot"> | undefined;
    try {
      listed = await workspaceOf(workspace);
    } catch (error) {
      report("Wombat can't choose an items folder now", error);
      return;
    }
    if (listed === undefined) {
      report("Wombat can't choose an items folder", new Error(UNLISTED));
      return;
    }
    let folder: string | undefined;
    try {
      folder = await pick(listed.itemsRoot, parent);
      if (folder === undefined) return;
      await check(folder);
    } catch (error) {
      report("Wombat can't use that items folder", error);
      return;
    }
    try {
      await setItemsRoot(workspace, folder);
    } catch (error) {
      report("Wombat couldn't change the items folder", error);
    }
  };
