/// <reference types="node" />
// Node-only. Which paths are folders, for the service (a workspace's `missing`, the folders it takes) and the app
// (the settings upgrade hands over only the folders the service takes).
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Whether `path` is an existing folder now; false, never a throw, when it can't be checked (EACCES, a dropped mount). */
export const isFolder = (path: string): boolean => {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
};

const canOpen = (path: string) => {
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Whether the service takes `path` as a workspace or an items folder: an absolute path to an existing folder it can read. */
export const usableFolder = (path: string): boolean => isAbsolute(path) && isFolder(path) && canOpen(path);
