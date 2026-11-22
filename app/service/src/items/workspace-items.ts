// Each workspace's items: its catalog, the watch of its items folder, its writer and its `.wombat/AGENTS.md`, opened
// for every listed workspace at start, on an add and on an items-folder change, and closed with the service. The
// routes, the manager and main ask here; nothing else opens them.
import type { Workspace } from "@wombat/shared/api";
import { errorCode } from "@wombat/shared/errno";

import { logToStderr, type Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { openCatalog, type Catalog } from "./catalog.ts";
import { openInstructions, readInstructions, refreshingWriter, type Instructions } from "./instructions.ts";
import { openWatch, type Watch } from "./watch.ts";
import { openWriter, type Writer } from "./write.ts";

/** A workspace's items as the routes and the proposals reach them. */
export type ItemsOfWorkspace = { catalog: Catalog; writer: Writer };

export type WorkspaceItemsOptions = {
  store: Store;
  log?: Log;
  /** Called with the workspace's id after each change to its items: a hand edit the watch reports, or a write of the service's. */
  onChanged: (workspaceId: string) => void;
};

type Opened = {
  workspace: Workspace;
  items: ItemsOfWorkspace | undefined;
  watch: Watch | undefined;
  instructions: Instructions | undefined;
  /** Set once it's replaced or closed: a write still running through its writer then renders nothing. */
  closed: boolean;
};

/** Whether a workspace opened while its folder was missing has its folder back, so it needs opening again. */
export const folderCameBack = (openedAs: Workspace, now: Workspace | undefined): now is Workspace =>
  openedAs.missing && now !== undefined && !now.missing;

export const openWorkspaceItems = ({ store, log = logToStderr, onChanged }: WorkspaceItemsOptions) => {
  const opened = new Map<string, Opened>();
  /** One open, reopen or close at a time per workspace, in the order asked. */
  const queues = new Map<string, Promise<void>>();
  let closing = false;

  const queued = (id: string, job: () => Promise<void>): Promise<void> => {
    const run = (queues.get(id) ?? Promise.resolve()).then(job);
    queues.set(id, run.catch(() => undefined));
    return run;
  };

  const alert = (id: string) => {
    // The change is on disk by now: a failed alert mustn't fail the write, and the watch alerts for it anyway.
    try {
      onChanged(id);
    } catch (error) {
      log("items_alert_failed", { error: errorCode(error) });
    }
  };

  /**
   * Opens `workspace`'s items when it has an items folder, and its instructions file while its folder exists (a render
   * would make the folder again); without an items folder that removes a stale file. Resolves once the file is in place.
   */
  const openOne = async (workspace: Workspace): Promise<Opened> => {
    const { id, root, itemsRoot } = workspace;
    const catalog = itemsRoot === undefined ? undefined : openCatalog({ root: itemsRoot, store, workspace: id, log });
    const watch = itemsRoot === undefined ? undefined : openWatch({ root: itemsRoot, log });
    const instructions = workspace.missing ? undefined : openInstructions({ catalog, workspaceRoot: root, ...(watch === undefined ? {} : { watch }), log });
    const entry: Opened = { workspace, items: undefined, watch, instructions, closed: false };
    // Written (or a stale one removed) before anything can start an agent here, so the first one gets it.
    await instructions?.refresh();
    instructions?.watch();
    watch?.on(() => onChanged(id));
    if (catalog !== undefined && itemsRoot !== undefined) {
      const afterWrite = async () => {
        if (!entry.closed) await instructions?.refresh();
        alert(id);
      };
      // Approvals write through this writer too, so they alert here.
      entry.items = { catalog, writer: refreshingWriter(openWriter({ root: itemsRoot, store, workspace: id, log }), afterWrite) };
    }
    return entry;
  };

  const closeOne = async (entry: Opened) => {
    entry.closed = true;
    await entry.instructions?.close();
    entry.watch?.close();
  };

  /** Run inside the workspace's queue. The old watch and renders stop first, so nothing of them lands after the new file. */
  const replace = async (workspace: Workspace) => {
    const previous = opened.get(workspace.id);
    if (previous !== undefined) await closeOne(previous);
    opened.set(workspace.id, await openOne(workspace));
  };

  /** Run inside the workspace's queue: reopens one opened while its folder was missing once the folder is back. */
  const repairIfBack = async (workspaceId: string) => {
    const entry = opened.get(workspaceId);
    if (entry === undefined) return;
    const now = store.getWorkspace(workspaceId);
    if (folderCameBack(entry.workspace, now)) await replace(now);
  };

  /** Opens `workspace` unless it's open already; one opened while its folder was missing is reopened once it's back. */
  const open = (workspace: Workspace): Promise<void> =>
    queued(workspace.id, async () => {
      if (closing) return;
      if (opened.has(workspace.id)) await repairIfBack(workspace.id);
      else opened.set(workspace.id, await openOne(workspace));
    });

  /** Opens `workspace` as it is now (its items folder changed), in place of what was open. */
  const reopen = (workspace: Workspace): Promise<void> =>
    queued(workspace.id, async () => {
      if (!closing) await replace(workspace);
    });

  /** The workspace's catalog and writer; undefined for one without an items folder, or not open. */
  const of = (workspaceId: string): ItemsOfWorkspace | undefined => opened.get(workspaceId)?.items;

  /**
   * The text of the workspace's instructions file, rendered now (written only when it changed), so a folder that went
   * and came back since its last render gets the file before an agent starts there; undefined when there is none.
   */
  const instructionsOf = async (workspaceId: string): Promise<string | undefined> => {
    let text: string | undefined;
    await queued(workspaceId, async () => {
      if (closing) return;
      await repairIfBack(workspaceId);
      const entry = opened.get(workspaceId);
      if (entry?.instructions === undefined) return;
      await entry.instructions.refresh();
      text = await readInstructions(entry.workspace.root, log);
    });
    return text;
  };

  /** Stops every watch and waits for every render in progress; later opens do nothing. */
  const close = async (): Promise<void> => {
    closing = true;
    await Promise.all([...queues.values()]);
    const entries = [...opened.values()];
    opened.clear();
    await Promise.all(entries.map(closeOne));
  };

  return { of, open, reopen, instructionsOf, close };
};

export type WorkspaceItems = ReturnType<typeof openWorkspaceItems>;
