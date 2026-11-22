import type { Workspace } from "@wombat/shared/api";
import type { BrowserWindow } from "electron";

/** What the picker shows of the workspace whose items folder it chooses. */
export type ItemsFolderFor = Pick<Workspace, "name" | "root" | "itemsRoot">;

const UNLISTED =
  "The service lists no workspace with that id, so there's none to choose an items folder for. Choose it from the workspace's Desk, or with Choose Items Folder… in the File menu.";

export type ChooseItemsFolderDeps = {
  /** The workspace as the service lists it now (its items folder is where the picker opens); undefined when it isn't listed. */
  workspaceOf: (workspace: string) => Promise<ItemsFolderFor | undefined>;
  /** The folder picker for `workspace`'s items folder, opening at its current one, modal to `parent`; undefined when it's cancelled. */
  pick: (workspace: ItemsFolderFor, parent: BrowserWindow | undefined) => Promise<string | undefined>;
  /** Gives the service `folder` as the workspace's items folder (PUT /workspaces/:ws/items-root); rejects with its refusal. */
  setItemsRoot: (workspace: string, folder: string) => Promise<unknown>;
  report: (title: string, error: unknown) => void;
};

/**
 * Choose Items Folder… for workspace `workspace`: the picker, then the service takes the folder at once (no restart:
 * its agents keep running) or refuses it. No picker opens for a workspace the service doesn't list. A cancel or a
 * refused folder leaves the items folder as it was. Reports its own errors.
 */
export const itemsFolderChooser =
  ({ workspaceOf, pick, setItemsRoot, report }: ChooseItemsFolderDeps) =>
  async (workspace: string, parent: BrowserWindow | undefined): Promise<void> => {
    let listed: ItemsFolderFor | undefined;
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
      folder = await pick(listed, parent);
    } catch (error) {
      report("Wombat can't choose an items folder now", error);
      return;
    }
    if (folder === undefined) return;
    try {
      await setItemsRoot(workspace, folder);
    } catch (error) {
      report("Wombat couldn't change the items folder", error);
    }
  };
