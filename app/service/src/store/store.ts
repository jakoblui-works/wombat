import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AgentSummary, Item } from "@wombat/shared/api";

/** The default cap on one agent's stored items, in bytes of their stored JSON. */
export const ITEM_BYTES_PER_AGENT = 16 * 1024 * 1024;

const SCHEMA_VERSION = 1;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An item as handed to `append`: the store adds `seq` and `agentId`, and `at` when it's missing. */
export type ItemEntry = DistributiveOmit<Item, "seq" | "agentId" | "at"> & { at?: string };

export type StoreOptions = {
  path: string;
  maxItemBytesPerAgent?: number;
  now?: () => Date;
  newDbId?: () => string;
};

export type Store = {
  /** Random per database file; a different one means the history was deleted or replaced. */
  readonly dbId: string;
  /** The last seq handed out; 0 for a fresh database. */
  currentSeq: () => number;
  /** Stores the entries as one transaction and returns their seqs; throws, storing nothing, on failure. */
  append: (agentId: string, entries: ItemEntry[]) => number[];
  putAgent: (summary: AgentSummary) => number;
  listAgents: () => AgentSummary[];
  /** Removes the agent and all its items; undefined (and no seq taken) when it isn't stored. */
  deleteAgent: (agentId: string) => number | undefined;
  /** `truncated` is true exactly when an item of this agent after `after` was dropped by the cap. */
  items: (agentId: string, after?: number, limit?: number) => { items: Item[]; truncated: boolean };
  close: () => void;
};

const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

// The seq counter lives in `meta` rather than coming from a rowid, which would reuse seqs after deletes.
// `dropped_through` is the highest seq of the agent's items the cap removed, which answers `truncated`.
const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value ANY NOT NULL) STRICT;
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    item_bytes INTEGER NOT NULL DEFAULT 0,
    dropped_through INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE TABLE items (
    seq INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    body TEXT NOT NULL
  ) STRICT;
  CREATE INDEX items_by_agent ON items (agent_id, seq);
`;

/** SQLite creates these with the database's mode; ones left looser are tightened on open. */
const sideFiles = (path: string) => [`${path}-wal`, `${path}-shm`];

const makePrivate = (path: string) => {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
  chmodSync(dir, PRIVATE_DIR);
  // Created before SQLite opens it, so it never exists with the umask's mode.
  closeSync(openSync(path, "a", PRIVATE_FILE));
  for (const file of [path, ...sideFiles(path)]) {
    if (existsSync(file)) chmodSync(file, PRIVATE_FILE);
  }
};

const asNumber = (value: unknown) => {
  if (typeof value !== "number") throw new Error(`Expected a number in the database, got ${typeof value}.`);
  return value;
};

const asString = (value: unknown) => {
  if (typeof value !== "string") throw new Error(`Expected text in the database, got ${typeof value}.`);
  return value;
};

/**
 * Opens (or creates) the database at `path`: agent summaries and an append-only log of their items, with one
 * seq counter across all agents.
 */
export const openStore = ({
  path,
  maxItemBytesPerAgent = ITEM_BYTES_PER_AGENT,
  now = () => new Date(),
  newDbId = randomUUID,
}: StoreOptions): Store => {
  makePrivate(path);
  const db = new DatabaseSync(path);

  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      // SQLite rolls back by itself on some errors (SQLITE_FULL, IOERR); a second ROLLBACK would hide them.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };

  try {
    const version = asNumber(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `The database ${path} has schema version ${version}, newer than this Wombat reads (${SCHEMA_VERSION}). ` +
          "Update Wombat, or move the file away to start with an empty history.",
      );
    }
    db.exec("PRAGMA journal_mode = WAL");
    // Commits are durable before the service alerts about them; WAL's usual NORMAL could lose the last ones.
    db.exec("PRAGMA synchronous = FULL");
    if (version === 0) {
      transaction(() => {
        db.exec(SCHEMA);
        const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
        insertMeta.run("db_id", newDbId());
        insertMeta.run("seq", 0);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }
  for (const file of sideFiles(path)) {
    if (existsSync(file)) chmodSync(file, PRIVATE_FILE);
  }

  const dbId = asString(db.prepare("SELECT value FROM meta WHERE key = 'db_id'").get()?.value);

  const statements = {
    seq: db.prepare("SELECT value FROM meta WHERE key = 'seq'"),
    takeSeqs: db.prepare("UPDATE meta SET value = value + ? WHERE key = 'seq' RETURNING value"),
    agentExists: db.prepare("SELECT 1 FROM agents WHERE id = ?"),
    putAgent: db.prepare(
      `INSERT INTO agents (id, started_at, summary) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at, summary = excluded.summary`,
    ),
    listAgents: db.prepare("SELECT summary FROM agents ORDER BY started_at, id"),
    deleteAgent: db.prepare("DELETE FROM agents WHERE id = ?"),
    deleteAgentItems: db.prepare("DELETE FROM items WHERE agent_id = ?"),
    insertItem: db.prepare("INSERT INTO items (seq, agent_id, bytes, body) VALUES (?, ?, ?, ?)"),
    addBytes: db.prepare("UPDATE agents SET item_bytes = item_bytes + ? WHERE id = ? RETURNING item_bytes"),
    oldestItems: db.prepare("SELECT seq, bytes FROM items WHERE agent_id = ? ORDER BY seq"),
    dropItems: db.prepare("DELETE FROM items WHERE agent_id = ? AND seq <= ?"),
    recordDropped: db.prepare(
      "UPDATE agents SET item_bytes = item_bytes - ?, dropped_through = max(dropped_through, ?) WHERE id = ?",
    ),
    items: db.prepare("SELECT seq, body FROM items WHERE agent_id = ? AND seq > ? ORDER BY seq LIMIT ?"),
    droppedThrough: db.prepare("SELECT dropped_through FROM agents WHERE id = ?"),
  };

  const currentSeq = () => asNumber(statements.seq.get()?.value);

  /** Takes `count` seqs; only inside a transaction, so a rollback gives them back. */
  const takeSeqs = (count: number) => {
    const last = asNumber(statements.takeSeqs.get(count)?.value);
    return Array.from({ length: count }, (_, index) => last - count + 1 + index);
  };

  /** Deletes the agent's oldest items until its total fits the cap, always keeping the newest. */
  const enforceCap = (agentId: string, totalBytes: number) => {
    let remaining = totalBytes;
    let dropThrough: number | undefined;
    let droppedBytes = 0;
    let previous: { seq: number; bytes: number } | undefined;
    for (const row of statements.oldestItems.iterate(agentId)) {
      if (remaining <= maxItemBytesPerAgent) break;
      // Each row is dropped only once a newer one is known to exist.
      if (previous !== undefined) {
        dropThrough = previous.seq;
        droppedBytes += previous.bytes;
        remaining -= previous.bytes;
        if (remaining <= maxItemBytesPerAgent) break;
      }
      previous = { seq: asNumber(row.seq), bytes: asNumber(row.bytes) };
    }
    if (dropThrough === undefined) return;
    statements.dropItems.run(agentId, dropThrough);
    statements.recordDropped.run(droppedBytes, dropThrough, agentId);
  };

  const append = (agentId: string, entries: ItemEntry[]) => {
    // Serialized before the transaction, so an entry that can't be stored fails the batch before any write.
    const bodies = entries.map((entry) => JSON.stringify({ ...entry, at: entry.at ?? now().toISOString() }));
    return transaction(() => {
      if (statements.agentExists.get(agentId) === undefined) {
        throw new Error(`Can't store items for agent ${agentId}: it isn't in the store. Add it with putAgent first.`);
      }
      const seqs = takeSeqs(bodies.length);
      let bytes = 0;
      bodies.forEach((body, index) => {
        const size = Buffer.byteLength(body);
        bytes += size;
        statements.insertItem.run(seqs[index] ?? 0, agentId, size, body);
      });
      const total = asNumber(statements.addBytes.get(bytes, agentId)?.item_bytes);
      if (total > maxItemBytesPerAgent) enforceCap(agentId, total);
      return seqs;
    });
  };

  const putAgent = (summary: AgentSummary) => {
    const body = JSON.stringify(summary);
    return transaction(() => {
      const [seq = 0] = takeSeqs(1);
      statements.putAgent.run(summary.id, summary.startedAt, body);
      return seq;
    });
  };

  const listAgents = () =>
    statements.listAgents.all().map((row) => JSON.parse(asString(row.summary)) as AgentSummary);

  const deleteAgent = (agentId: string) =>
    transaction(() => {
      if (statements.deleteAgent.run(agentId).changes === 0) return undefined;
      statements.deleteAgentItems.run(agentId);
      const [seq = 0] = takeSeqs(1);
      return seq;
    });

  const items = (agentId: string, after = 0, limit?: number) => {
    // A negative LIMIT means no limit in SQLite.
    const rows = statements.items.all(agentId, after, limit ?? -1);
    const droppedThrough = statements.droppedThrough.get(agentId)?.dropped_through;
    return {
      items: rows.map(
        (row) => ({ ...(JSON.parse(asString(row.body)) as ItemEntry), seq: asNumber(row.seq), agentId }) as Item,
      ),
      truncated: droppedThrough !== undefined && asNumber(droppedThrough) > after,
    };
  };

  return {
    dbId,
    currentSeq,
    append,
    putAgent,
    listAgents,
    deleteAgent,
    items,
    close: () => db.close(),
  };
};
