// The workspace list: the page lists it; only main adds a folder or sets its items folder, since those take a path.
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { WorkspaceErrorCode, type Workspace } from "@wombat/shared/api";
import { ROUTES, type ResponseOf } from "@wombat/shared/routes";
import type { Context, Hono } from "hono";

import type { WorkspaceItems } from "../items/workspace-items.ts";
import type { Store } from "../store/store.ts";
import { workspaceNotFound } from "../workspace.ts";
import { errorResponse, WORKSPACE_STATUS } from "./errors.ts";
import { checked, readBody } from "./request.ts";

export type WorkspaceRoutesOptions = {
  store: Store;
  /** Called after a committed add or items-folder change, with its seq. */
  workspacesCommitted: (seq: number) => void;
  /** Opens an added workspace's items, and opens them again on an items-folder change, before the route answers. */
  items?: Pick<WorkspaceItems, "open" | "reopen">;
};

type FolderUse = "workspace" | "items folder";

const isFolder = (path: string) => {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
};

/** Why `path` can't be used as `use`, or undefined when it's the absolute path of an existing folder. */
export const folderRefusal = (path: string, use: FolderUse, folderAt: (path: string) => boolean): string | undefined => {
  const as = use === "workspace" ? "a workspace" : "the items folder";
  if (!isAbsolute(path)) return `Can't use ${path} as ${as}: it's a relative path. Send the folder's absolute path.`;
  if (!folderAt(path)) {
    return `Can't use ${path} as ${as}: there's no folder there you can open (it's missing, a file, or not readable). Choose an existing folder and try again.`;
  }
  return undefined;
};

const refused = (c: Context, message: string) => errorResponse(c, WORKSPACE_STATUS.invalid_folder, WorkspaceErrorCode.enum.invalid_folder, message);

export const workspaceRoutes = (app: Hono, { store, workspacesCommitted, items }: WorkspaceRoutesOptions) => {
  /**
   * Runs `write` and takes its alert's seq in one transaction when it changed anything; once committed, opens the
   * workspace's items with `open`, then alerts, so the app's read after the alert finds them.
   */
  const alerting = async (write: () => { workspace: Workspace; changed: boolean }, open: (workspace: Workspace) => Promise<void> | undefined) => {
    const { workspace, seq } = store.transaction(() => {
      const result = write();
      return { workspace: result.workspace, seq: result.changed ? store.takeSeq() : undefined };
    });
    await open(workspace);
    if (seq !== undefined) workspacesCommitted(seq);
    return workspace;
  };

  app.get("/workspaces", (c) =>
    c.json(checked(ROUTES.listWorkspaces.response, { workspaces: store.listWorkspaces() }) satisfies ResponseOf<typeof ROUTES.listWorkspaces>),
  );

  app.post("/workspaces", async (c) => {
    const { root, itemsRoot, adopt } = await readBody(c, ROUTES.addWorkspace.body);
    const refusalNow = () =>
      folderRefusal(root, "workspace", isFolder) ?? (itemsRoot === undefined ? undefined : folderRefusal(itemsRoot, "items folder", isFolder));
    const refusal = refusalNow();
    if (refusal !== undefined) return refused(c, refusal);
    let workspace: Workspace;
    try {
      workspace = await alerting(
        () => {
          const { workspace: stored, added } = store.addWorkspace(root, itemsRoot);
          const adopted = adopt === true ? store.adoptUnassigned(stored.id) : undefined;
          const adoptedAny = adopted !== undefined && adopted.agents + adopted.proposals + adopted.counters > 0;
          return { workspace: stored, changed: added || adoptedAny };
        },
        // A root already listed is open already, as it was.
        (stored) => items?.open(stored),
      );
    } catch (error) {
      // The folder may have gone since the check above; the store then refuses it.
      const gone = refusalNow();
      if (gone !== undefined) return refused(c, gone);
      throw error;
    }
    return c.json(checked(ROUTES.addWorkspace.response, workspace) satisfies ResponseOf<typeof ROUTES.addWorkspace>);
  });

  app.put("/workspaces/:ws/items-root", async (c) => {
    const { itemsRoot } = await readBody(c, ROUTES.setItemsRoot.body);
    const id = c.req.param("ws");
    const refusal = folderRefusal(itemsRoot, "items folder", isFolder);
    if (refusal !== undefined) return refused(c, refusal);
    if (store.getWorkspace(id) === undefined) {
      const { code, message } = workspaceNotFound(id);
      return errorResponse(c, WORKSPACE_STATUS[code], code, message);
    }
    const workspace = await alerting(
      () => {
        const changed = store.setItemsRoot(id, itemsRoot);
        if (changed === undefined) throw new Error(`Workspace ${id} vanished while its items folder was being set.`);
        return { workspace: changed, changed: true };
      },
      (changed) => items?.reopen(changed),
    );
    return c.json(checked(ROUTES.setItemsRoot.response, workspace) satisfies ResponseOf<typeof ROUTES.setItemsRoot>);
  });
};
