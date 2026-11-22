// Open Folder… and Choose Items Folder…; and the old workbench's shown workspace (the one chosen last while the service
// lists it, else the first listed), which the shell doesn't use: its shell state owns the shown workspace.
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { Workspace } from "@wombat/shared/api";
import { useWorkspaces } from "./hooks.ts";
import { keys } from "./keys.ts";
import { workspacesQuery } from "./query-client.ts";
import { refresh } from "./refresh.ts";

let chosen: string | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The shown workspace among `listed`: `chosenId`'s while listed, else the first; undefined while none is listed. */
export const shownOf = (listed: readonly Workspace[] | undefined, chosenId: string | undefined): Workspace | undefined =>
  listed?.find(({ id }) => id === chosenId) ?? listed?.[0];

/** Shows workspace `id` (once the list holds it, if it doesn't yet). */
export const showWorkspace = (id: string): void => {
  if (chosen === id) return;
  chosen = id;
  for (const listener of listeners) listener();
};

/** The workspace the page shows; undefined while the list isn't read or holds none. */
export const useShownWorkspace = (): Workspace | undefined => shownOf(useWorkspaces().data?.workspaces, useSyncExternalStore(subscribe, () => chosen));

/** The shown workspace outside a component; rejects when the list can't be read. */
export const shownWorkspaceIn = async (queryClient: QueryClient): Promise<Workspace | undefined> =>
  shownOf((await queryClient.ensureQueryData(workspacesQuery())).workspaces, chosen);

const NO_WORKSPACE = "The service lists no workspace yet. Open one with File → Open Folder…, then try again.";

/** The shown workspace's id; rejects, saying how to add one, while none is listed. */
export const shownWorkspaceId = async (queryClient: QueryClient): Promise<string> => {
  const shown = await shownWorkspaceIn(queryClient);
  if (shown === undefined) throw new Error(NO_WORKSPACE);
  return shown.id;
};

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
