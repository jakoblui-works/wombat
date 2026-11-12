import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import type { Problem, Proposal, ProposalStatus } from "@wombat/shared/items";
import { ensurePrivateFile, tightenPrivateFile } from "@wombat/shared/private-file";


/** The default cap on one agent's stored entries, in bytes of their stored JSON. */
export const LOG_BYTES_PER_AGENT = 16 * 1024 * 1024;

const SCHEMA_VERSION = 3;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An entry as handed to `append`: the store adds `seq` and `agentId`, and `at` when it's missing. */
export type NewLogEntry = DistributiveOmit<LogEntry, "seq" | "agentId" | "at"> & { at?: string };

/**
 * A proposal as stored: it names its item by id (`itemId`, null for a create until it's approved), since handles
 * change by hand; the access module turns the id into the item's current handle.
 */
export type StoredProposal = Omit<Proposal, "handle"> & { itemId: string | null };

/** A proposal as handed to `insertProposal`: the store adds the id, `at` and the pending status. */
export type NewProposal = Pick<StoredProposal, "structure" | "itemId" | "kind" | "fields" | "file" | "reason" | "baseVersion" | "agentId">;

/** A proposal write and the seq it took, to alert about once it's committed. */
export type ProposalChange = { proposal: StoredProposal; seq: number };

export type StoreOptions = {
  path: string;
  maxLogBytesPerAgent?: number;
  now?: () => Date;
  newDbId?: () => string;
};

export type Store = {
  /** Random per database file; a different one means the history was deleted or replaced. */
  readonly dbId: string;
  /** The last seq handed out; 0 for a fresh database. */
  currentSeq: () => number;
  /** Stores the entries as one transaction and returns their seqs; throws, storing nothing, on failure. */
  append: (agentId: string, entries: NewLogEntry[]) => number[];
  putAgent: (summary: AgentSummary) => number;
  listAgents: () => AgentSummary[];
  /** Removes the agent and all its entries; undefined (and no seq taken) when it isn't stored. */
  deleteAgent: (agentId: string) => number | undefined;
  /** `truncated` is true exactly when an entry of this agent after `after` was dropped by the cap. */
  readLog: (agentId: string, after?: number, limit?: number) => { entries: LogEntry[]; truncated: boolean };
  /**
   * The next handle number of a structure: one above both the last number it gave and `floor` (the highest
   * number on disk), remembered so a deleted item's number is never given again.
   */
  nextHandleNumber: (structure: string, floor: number) => number;
  /** Stores a pending proposal, taking the next seq in the same transaction. */
  insertProposal: (proposal: NewProposal) => ProposalChange;
  /** Every proposal, or those with `status`, oldest first. */
  listProposals: (status?: ProposalStatus) => StoredProposal[];
  getProposal: (id: string) => StoredProposal | undefined;
  /**
   * Decides a pending proposal (setting `decidedAt`, and `itemId` for an approved create), taking the next seq in
   * the same transaction; undefined, and no seq taken, when it's missing or no longer pending.
   */
  setProposalStatus: (id: string, status: Exclude<ProposalStatus, "pending">, problem?: Problem, itemId?: string) => ProposalChange | undefined;
  close: () => void;
};

// The seq counter lives in `meta` rather than coming from a rowid, which would reuse seqs after deletes.
// `dropped_through` is the highest seq of the agent's entries the cap removed, which answers `truncated`.
const SCHEMA_V1 = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value ANY NOT NULL) STRICT;
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    log_bytes INTEGER NOT NULL DEFAULT 0,
    dropped_through INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE TABLE log_entries (
    seq INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    body TEXT NOT NULL
  ) STRICT;
  CREATE INDEX log_entries_by_agent ON log_entries (agent_id, seq);
`;

// Items: `item_counters.last` is the last handle number given per structure id. A proposal names its item by id
// (`item_id`, null for a pending create), since handles change by hand; `file` is a free-named create's path, kept
// apart from `fields` so it can't collide with a property named `file`; `fields` and `problem` are JSON.
const SCHEMA_V2 = `
  CREATE TABLE item_counters (structure TEXT PRIMARY KEY, last INTEGER NOT NULL) STRICT;
  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    structure TEXT NOT NULL,
    item_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
    fields TEXT NOT NULL,
    file TEXT,
    reason TEXT NOT NULL,
    base_version TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'conflict')),
    agent_id TEXT NOT NULL,
    at TEXT NOT NULL,
    decided_at TEXT,
    problem TEXT
  ) STRICT;
  CREATE INDEX proposals_by_status ON proposals (status, at);
`;

// The summary row is JSON, so new summary fields need no column; summaries written before `pendingPermissions`
// existed get it as [] (no request outlives the service that held it).
const SCHEMA_V3 = `
  UPDATE agents SET summary = json_insert(summary, '$.pendingPermissions', json('[]'));
`;

/** SQLite creates these with the database's mode; ones left looser are tightened on open. */
const sideFiles = (path: string) => [`${path}-wal`, `${path}-shm`];

const makePrivate = (path: string) => {
  // Created before SQLite opens it, so it never exists with the umask's mode.
  ensurePrivateFile(path);
  for (const file of sideFiles(path)) tightenPrivateFile(file);
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
 * Opens (or creates) the database at `path`: agent summaries and an append-only log of their entries, with one
 * seq counter across all agents, and the items' handle counters and proposals. An older schema is upgraded in place.
 */
export const openStore = ({
  path,
  maxLogBytesPerAgent = LOG_BYTES_PER_AGENT,
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
    if (version < SCHEMA_VERSION) {
      // One transaction from any older version, so a failed upgrade leaves the file as it was.
      transaction(() => {
        if (version < 1) {
          db.exec(SCHEMA_V1);
          const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
          insertMeta.run("db_id", newDbId());
          insertMeta.run("seq", 0);
        }
        if (version < 2) db.exec(SCHEMA_V2);
        if (version < 3) db.exec(SCHEMA_V3);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }
  for (const file of sideFiles(path)) tightenPrivateFile(file);

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
    deleteAgentLog: db.prepare("DELETE FROM log_entries WHERE agent_id = ?"),
    insertLogEntry: db.prepare("INSERT INTO log_entries (seq, agent_id, bytes, body) VALUES (?, ?, ?, ?)"),
    addBytes: db.prepare("UPDATE agents SET log_bytes = log_bytes + ? WHERE id = ? RETURNING log_bytes"),
    oldestLogEntries: db.prepare("SELECT seq, bytes FROM log_entries WHERE agent_id = ? ORDER BY seq"),
    dropLogEntries: db.prepare("DELETE FROM log_entries WHERE agent_id = ? AND seq <= ?"),
    recordDropped: db.prepare(
      "UPDATE agents SET log_bytes = log_bytes - ?, dropped_through = max(dropped_through, ?) WHERE id = ?",
    ),
    logEntries: db.prepare("SELECT seq, body FROM log_entries WHERE agent_id = ? AND seq > ? ORDER BY seq LIMIT ?"),
    droppedThrough: db.prepare("SELECT dropped_through FROM agents WHERE id = ?"),
    nextHandleNumber: db.prepare(
      `INSERT INTO item_counters (structure, last) VALUES (?, ? + 1)
       ON CONFLICT (structure) DO UPDATE SET last = max(last, excluded.last - 1) + 1 RETURNING last`,
    ),
    insertProposal: db.prepare(
      `INSERT INTO proposals (id, structure, item_id, kind, fields, file, reason, base_version, status, agent_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING *`,
    ),
    listProposals: db.prepare("SELECT * FROM proposals ORDER BY at, rowid"),
    listProposalsWith: db.prepare("SELECT * FROM proposals WHERE status = ? ORDER BY at, rowid"),
    getProposal: db.prepare("SELECT * FROM proposals WHERE id = ?"),
    decideProposal: db.prepare(
      `UPDATE proposals SET status = ?, decided_at = ?, problem = ?, item_id = coalesce(?, item_id)
       WHERE id = ? AND status = 'pending' RETURNING *`,
    ),
  };

  const currentSeq = () => asNumber(statements.seq.get()?.value);

  /** Takes `count` seqs; only inside a transaction, so a rollback gives them back. */
  const takeSeqs = (count: number) => {
    const last = asNumber(statements.takeSeqs.get(count)?.value);
    return Array.from({ length: count }, (_, index) => last - count + 1 + index);
  };

  /** Deletes the agent's oldest entries until its total fits the cap, always keeping the newest. */
  const enforceCap = (agentId: string, totalBytes: number) => {
    let remaining = totalBytes;
    let dropThrough: number | undefined;
    let droppedBytes = 0;
    let previous: { seq: number; bytes: number } | undefined;
    for (const row of statements.oldestLogEntries.iterate(agentId)) {
      if (remaining <= maxLogBytesPerAgent) break;
      // Each row is dropped only once a newer one is known to exist.
      if (previous !== undefined) {
        dropThrough = previous.seq;
        droppedBytes += previous.bytes;
        remaining -= previous.bytes;
        if (remaining <= maxLogBytesPerAgent) break;
      }
      previous = { seq: asNumber(row.seq), bytes: asNumber(row.bytes) };
    }
    if (dropThrough === undefined) return;
    statements.dropLogEntries.run(agentId, dropThrough);
    statements.recordDropped.run(droppedBytes, dropThrough, agentId);
  };

  const append = (agentId: string, entries: NewLogEntry[]) => {
    // Serialized before the transaction, so an entry that can't be stored fails the batch before any write.
    const bodies = entries.map((entry) => JSON.stringify({ ...entry, at: entry.at ?? now().toISOString() }));
    return transaction(() => {
      if (statements.agentExists.get(agentId) === undefined) {
        throw new Error(`Can't store entries for agent ${agentId}: it isn't in the store. Add it with putAgent first.`);
      }
      const seqs = takeSeqs(bodies.length);
      let bytes = 0;
      bodies.forEach((body, index) => {
        const size = Buffer.byteLength(body);
        bytes += size;
        statements.insertLogEntry.run(seqs[index] ?? 0, agentId, size, body);
      });
      const total = asNumber(statements.addBytes.get(bytes, agentId)?.log_bytes);
      if (total > maxLogBytesPerAgent) enforceCap(agentId, total);
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
      statements.deleteAgentLog.run(agentId);
      const [seq = 0] = takeSeqs(1);
      return seq;
    });

  const readLog = (agentId: string, after = 0, limit?: number) => {
    // A negative LIMIT means no limit in SQLite.
    const rows = statements.logEntries.all(agentId, after, limit ?? -1);
    const droppedThrough = statements.droppedThrough.get(agentId)?.dropped_through;
    return {
      entries: rows.map(
        (row) => ({ ...(JSON.parse(asString(row.body)) as NewLogEntry), seq: asNumber(row.seq), agentId }) as LogEntry,
      ),
      truncated: droppedThrough !== undefined && asNumber(droppedThrough) > after,
    };
  };

  const nextHandleNumber = (structure: string, floor: number) =>
    transaction(() => asNumber(statements.nextHandleNumber.get(structure, floor)?.last));

  const proposalOf = (row: Record<string, unknown>): StoredProposal => {
    const decidedAt = row.decided_at;
    const problem = row.problem;
    return {
      id: asString(row.id),
      structure: asString(row.structure),
      itemId: row.item_id === null ? null : asString(row.item_id),
      kind: asString(row.kind) as StoredProposal["kind"],
      fields: JSON.parse(asString(row.fields)) as Record<string, unknown>,
      file: row.file === null ? null : asString(row.file),
      reason: asString(row.reason),
      baseVersion: row.base_version === null ? null : asString(row.base_version),
      status: asString(row.status) as ProposalStatus,
      agentId: asString(row.agent_id),
      at: asString(row.at),
      ...(decidedAt === null || decidedAt === undefined ? {} : { decidedAt: asString(decidedAt) }),
      ...(problem === null || problem === undefined ? {} : { problem: JSON.parse(asString(problem)) as Problem }),
    };
  };

  const insertProposal = (proposal: NewProposal) => {
    const fields = JSON.stringify(proposal.fields);
    return transaction(() => {
      const [seq = 0] = takeSeqs(1);
      const row = statements.insertProposal.get(
        randomUUID(),
        proposal.structure,
        proposal.itemId,
        proposal.kind,
        fields,
        proposal.file,
        proposal.reason,
        proposal.baseVersion,
        proposal.agentId,
        now().toISOString(),
      );
      if (row === undefined) throw new Error("Storing the proposal returned no row.");
      return { proposal: proposalOf(row), seq };
    });
  };

  const listProposals = (status?: ProposalStatus) =>
    (status === undefined ? statements.listProposals.all() : statements.listProposalsWith.all(status)).map(proposalOf);

  const getProposal = (id: string) => {
    const row = statements.getProposal.get(id);
    return row === undefined ? undefined : proposalOf(row);
  };

  const setProposalStatus = (id: string, status: Exclude<ProposalStatus, "pending">, problem?: Problem, itemId?: string) => {
    const problemText = problem === undefined ? null : JSON.stringify(problem);
    return transaction(() => {
      const row = statements.decideProposal.get(status, now().toISOString(), problemText, itemId ?? null, id);
      if (row === undefined) return undefined;
      const [seq = 0] = takeSeqs(1);
      return { proposal: proposalOf(row), seq };
    });
  };

  return {
    dbId,
    currentSeq,
    append,
    putAgent,
    listAgents,
    deleteAgent,
    readLog,
    nextHandleNumber,
    insertProposal,
    listProposals,
    getProposal,
    setProposalStatus,
    close: () => db.close(),
  };
};
