import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { newWorkspaceId, type Workspace } from "@wombat/shared/api";
import { isFolder } from "@wombat/shared/folder";

import { asNullableString, asString } from "./values.ts";

/** How many stored rows `adoptUnassigned` gave the workspace. */
export type Adopted = { agents: number; proposals: number; counters: number };

/** Each write is one transaction and takes no seq; a caller that alerts takes one inside its own transaction. */
export type WorkspaceStore = {
  /**
   * The workspace whose root is `root`'s real path, added (`added: true`) with `itemsRoot`'s real path unless one is
   * stored; a stored one is answered unchanged, whatever `itemsRoot`. Throws when `root` isn't an existing folder.
   */
  addWorkspace: (root: string, itemsRoot?: string) => { workspace: Workspace; added: boolean };
  /** Every workspace, in the order they were added. */
  listWorkspaces: () => Workspace[];
  getWorkspace: (id: string) => Workspace | undefined;
  /** Undefined, nothing written, for an unknown id. */
  setItemsRoot: (id: string, itemsRoot: string) => Workspace | undefined;
  /**
   * Gives every agent and proposal without a workspace (stored before workspaces existed) to `id`, and the handle
   * counters without an items folder to its items folder; a counter the folder already has keeps the higher number. A
   * workspace without an items folder leaves those counters unadopted. Throws for an unknown id.
   */
  adoptUnassigned: (id: string) => Adopted;
};

type Transaction = <T>(fn: () => T) => T;

/** A stored row as the API sends it; `exists` tells whether the root is an existing folder now. */
export const workspaceOf = (row: Record<string, unknown>, exists: (path: string) => boolean): Workspace => {
  const root = asString(row.root);
  const itemsRoot = asNullableString(row.items_root);
  return { id: asString(row.id), name: basename(root), root, ...(itemsRoot === null ? {} : { itemsRoot }), missing: !exists(root) };
};

const realPathOf = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/** The handle counters are keyed by it, so two workspaces naming one folder by different paths share them. */
const realItemsRoot = (itemsRoot: string) => realPathOf(itemsRoot) ?? itemsRoot;

const realFolder = (root: string) => {
  const real = realPathOf(root);
  if (real === undefined || !isFolder(real)) {
    throw new Error(`Can't add the workspace ${root}: it isn't an existing folder. Choose an existing folder and add it again.`);
  }
  return real;
};

export const openWorkspaceStore = (db: DatabaseSync, transaction: Transaction, now: () => Date): WorkspaceStore => {
  const statements = {
    byRoot: db.prepare("SELECT * FROM workspaces WHERE root = ?"),
    byId: db.prepare("SELECT * FROM workspaces WHERE id = ?"),
    list: db.prepare("SELECT * FROM workspaces ORDER BY added_at, rowid"),
    insert: db.prepare("INSERT INTO workspaces (id, root, items_root, added_at) VALUES (?, ?, ?, ?)"),
    setItemsRoot: db.prepare("UPDATE workspaces SET items_root = ? WHERE id = ?"),
    adoptAgents: db.prepare("UPDATE agents SET summary = json_set(summary, '$.workspace', ?) WHERE json_extract(summary, '$.workspace') IS NULL"),
    adoptProposals: db.prepare("UPDATE proposals SET workspace = ? WHERE workspace IS NULL"),
    adoptCounters: db.prepare(
      `INSERT INTO item_counters (items_root, binder, last) SELECT ?, binder, last FROM item_counters WHERE items_root IS NULL
       ON CONFLICT (items_root, binder) DO UPDATE SET last = max(last, excluded.last)`,
    ),
    dropUnassignedCounters: db.prepare("DELETE FROM item_counters WHERE items_root IS NULL"),
  };

  const getWorkspace = (id: string) => {
    const row = statements.byId.get(id);
    return row === undefined ? undefined : workspaceOf(row, isFolder);
  };

  const addWorkspace = (root: string, itemsRoot?: string) => {
    const real = realFolder(root);
    return transaction(() => {
      const stored = statements.byRoot.get(real);
      if (stored !== undefined) return { workspace: workspaceOf(stored, isFolder), added: false };
      const id = newWorkspaceId();
      statements.insert.run(id, real, itemsRoot === undefined ? null : realItemsRoot(itemsRoot), now().toISOString());
      const workspace = getWorkspace(id);
      if (workspace === undefined) throw new Error(`Workspace ${real} vanished while it was being added.`);
      return { workspace, added: true };
    });
  };

  const setItemsRoot = (id: string, itemsRoot: string) =>
    transaction(() => (statements.setItemsRoot.run(realItemsRoot(itemsRoot), id).changes === 0 ? undefined : getWorkspace(id)));

  const adoptUnassigned = (id: string): Adopted =>
    transaction(() => {
      const row = statements.byId.get(id);
      if (row === undefined) throw new Error(`Can't adopt the stored rows into workspace ${id}: it isn't in the store. Add the workspace first.`);
      const agents = Number(statements.adoptAgents.run(id).changes);
      const proposals = Number(statements.adoptProposals.run(id).changes);
      const itemsRoot = asNullableString(row.items_root);
      if (itemsRoot === null) return { agents, proposals, counters: 0 };
      statements.adoptCounters.run(itemsRoot);
      const counters = Number(statements.dropUnassignedCounters.run().changes);
      return { agents, proposals, counters };
    });

  return {
    addWorkspace,
    listWorkspaces: () => statements.list.all().map((row) => workspaceOf(row, isFolder)),
    getWorkspace,
    setItemsRoot,
    adoptUnassigned,
  };
};
