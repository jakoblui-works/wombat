// Open Folder… and Choose Items Folder…: the folder pickers main shows for a workspace.
import type { QueryClient } from "@tanstack/react-query";

import { keys } from "./keys.ts";
import { refresh } from "./refresh.ts";

/** File → Open Folder…: the folder picker, the folder added to the service's workspaces, then shown by `show`. */
export const openFolder = async (queryClient: QueryClient, show: (id: string) => void): Promise<void> => {
  const id = await window.wombat.workspace.add();
  if (id === undefined) return;
  show(id);
  await refresh(queryClient, keys.workspaces);
};

/** Choose Items Folder…: the folder picker for workspace `id`'s items folder. */
export const chooseItemsFolder = async (id: string): Promise<void> => {
  await window.wombat.workspace.chooseItemsFolder(id);
};
