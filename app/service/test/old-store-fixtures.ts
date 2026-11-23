// Stores as older versions wrote them, for the tests that open one with the current service: each schema's tables
// exactly as that version created them, built in one place so no test checks a store that never existed.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Schema 1 and the schema 2 additions, exactly as that store wrote them; schema 3 changed no table. */
export const V2_SCHEMA = `
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

/** The proposals table and its versions as schema 4 rebuilt them; its other tables are schema 2's. */
export const V4_PROPOSALS = `
  DROP TABLE proposals;
  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL CHECK (target IN ('file', 'item')),
    path TEXT,
    structure TEXT,
    item_id TEXT,
    item_handle TEXT,
    kind TEXT NOT NULL,
    file TEXT,
    reason TEXT NOT NULL,
    base_version TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'applying', 'approved', 'rejected', 'conflict')),
    agent_id TEXT NOT NULL,
    at TEXT NOT NULL,
    decided_at TEXT,
    problem TEXT,
    reject_reason TEXT,
    intent TEXT,
    noted_seq INTEGER,
    last_version INTEGER NOT NULL CHECK (last_version >= 1),
    CHECK (
      (target = 'file' AND path IS NOT NULL AND structure IS NULL AND kind IN ('edit', 'create'))
      OR (target = 'item' AND path IS NULL AND structure IS NOT NULL AND kind IN ('create', 'update', 'delete'))
    )
  ) STRICT;
  CREATE TABLE proposal_versions (
    proposal_id TEXT NOT NULL REFERENCES proposals (id),
    n INTEGER NOT NULL CHECK (n >= 1),
    by TEXT NOT NULL CHECK (by IN ('agent', 'me')),
    content TEXT NOT NULL,
    reason TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (proposal_id, n)
  ) STRICT;
  CREATE INDEX proposals_by_status ON proposals (status, at);
  CREATE INDEX proposals_by_agent ON proposals (agent_id, status);
`;

/** Makes an open schema 4 database schema 5: its binder columns renamed from `structure`, no workspace anywhere. */
export const v4ToV5 = (db: DatabaseSync) => {
  db.exec("ALTER TABLE item_counters RENAME COLUMN structure TO binder; ALTER TABLE proposals RENAME COLUMN structure TO binder;");
  db.exec("PRAGMA user_version = 5");
};

/** A new schema 5 database at `path` with its meta and no rows, left open for the caller to add rows and close. */
export const newV5Store = (path: string, { dbId, seq }: { dbId: string; seq: number }) => {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(V2_SCHEMA);
  db.exec(V4_PROPOSALS);
  db.prepare("INSERT INTO meta (key, value) VALUES ('db_id', ?), ('seq', ?)").run(dbId, seq);
  v4ToV5(db);
  return db;
};
