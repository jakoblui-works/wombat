import type { Workspace } from "@wombat/shared/api";

/** Workspace `id`'s name among `listed`; undefined while the list isn't read or doesn't hold it. */
export const workspaceName = (listed: readonly Workspace[] | undefined, id: string): string | undefined => listed?.find((workspace) => workspace.id === id)?.name;
