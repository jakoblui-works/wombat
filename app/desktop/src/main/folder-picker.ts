import { type BrowserWindow, dialog } from "electron";

export type FolderPicker = {
  title: string;
  buttonLabel: string;
  defaultPath?: string | undefined;
  /** Under e2e the picker never opens and this is its answer; undefined is a cancel. */
  e2e: { answer: string | undefined } | undefined;
  /** The window the picker is modal to, so the window can't act while it's open; none before the window opens. */
  parent?: BrowserWindow | undefined;
};

/** A native folder picker; the chosen folder, or undefined when it's cancelled. */
export const pickFolder = async ({ title, buttonLabel, defaultPath, e2e, parent }: FolderPicker): Promise<string | undefined> => {
  if (e2e !== undefined) return e2e.answer;
  const options: Electron.OpenDialogOptions = {
    title,
    buttonLabel,
    properties: ["openDirectory", "createDirectory"],
    ...(defaultPath === undefined ? {} : { defaultPath }),
  };
  const { canceled, filePaths } = await (parent === undefined ? dialog.showOpenDialog(options) : dialog.showOpenDialog(parent, options));
  return canceled ? undefined : filePaths[0];
};
