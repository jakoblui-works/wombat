// The workspace list: the page lists it; only main adds a folder or sets its items folder, since those take a path.
import { isAbsolute } from "node:path";

import { WorkspaceErrorCode, type Workspace } from "@wombat/shared/api";
import { usableFolder } from "@wombat/shared/folder";
import { ROUTES, type ResponseOf } from "@wombat/shared/routes";
import type { Context, Hono } from "hono";

import type { WorkspaceItems } from "../items/workspace-items.ts";
import type { Store } from "../store/store.ts";
import type { Adopted } from "../store/workspaces.ts";
import { workspaceNotFound } from "../workspace.ts";
import { errorResponse, WORKSPACE_STATUS } from "./errors.ts";
import { checked, readBody } from "./request.ts";

export type WorkspaceRoutesOptions = {
  store: Store;
  /** Called after a committed add or items-folder change, with its seq. */
  workspacesCommitted: (seq: number) => void;
  /** Opens an added workspace's items, and opens them again on an items-folder change, before the route answers. */
  items?: Pick<WorkspaceItems, "open" | "reopen">;
  /** Called after an add adopted proposals, once the workspace's items are open, before the route answers. */
  proposalsAdopted: () => Promise<void>;
};

type FolderUse = "workspace" | "items folder";

/** Why `path` can't be used as `use`, or undefined when it's a usable folder (usableFolder). */
const folderRefusal = (path: string, use: FolderUse): string | undefined => {
  if (usableFolder(path)) return undefined;
  const as = use === "workspace" ? "a workspace" : "the items folder";
  if (!isAbsolute(path)) return `Can't use ${path} as ${as}: it's a relative path. Send the folder's absolute path.`;
  return `Can't use ${path} as ${as}: there's no folder there you can open (it's missing, a file, or not readable). Choose an existing folder you can read and try again.`;
};

const refused = (c: Context, message: string) => errorResponse(c, WORKSPACE_STATUS.invalid_folder, WorkspaceErrorCode.enum.invalid_folder, message);

export const workspaceRoutes = (app: Hono, { store, workspacesCommitted, items, proposalsAdopted }: WorkspaceRoutesOptions) => {
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
      folderRefusal(root, "workspace") ?? (itemsRoot === undefined ? undefined : folderRefusal(itemsRoot, "items folder"));
    const refusal = refusalNow();
    if (refusal !== undefined) return refused(c, refusal);
    let workspace: Workspace;
    let adopted: Adopted | undefined;
    try {
      workspace = await alerting(
        () => {
          const { workspace: stored, added } = store.addWorkspace(root, itemsRoot);
          adopted = adopt === true ? store.adoptUnassigned(stored.id) : undefined;
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
    if (adopted !== undefined && adopted.proposals > 0) await proposalsAdopted();
    return c.json(checked(ROUTES.addWorkspace.response, workspace) satisfies ResponseOf<typeof ROUTES.addWorkspace>);
  });

  app.put("/workspaces/:ws/items-root", async (c) => {
    const { itemsRoot } = await readBody(c, ROUTES.setItemsRoot.body);
    const id = c.req.param("ws");
    const refusal = folderRefusal(itemsRoot, "items folder");
    if (refusal !== undefined) return refused(c, refusal);
    if (store.getWorkspace(id) === undefined) throw workspaceNotFound(id);
    const workspace = await alerting(
      () => {
        const changed = store.setItemsRoot(id, itemsRoot);
        if (changed === undefined) {
          throw new Error(`Workspace ${id} left the service's list while its items folder was being set. List the workspaces, add its folder again if it's gone, then choose the items folder again.`);
        }
        return { workspace: changed, changed: true };
      },
      (changed) => items?.reopen(changed),
    );
    return c.json(checked(ROUTES.setItemsRoot.response, workspace) satisfies ResponseOf<typeof ROUTES.setItemsRoot>);
  });
};
