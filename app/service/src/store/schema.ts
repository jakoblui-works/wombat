import type { DatabaseSync } from "node:sqlite";

import { OUTCOMES } from "./proposal-rules.ts";

export const SCHEMA_VERSION = 5;

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

// Items: `item_counters.last` is the last handle number given per binder id.
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

// A CHECK can't be altered, so the proposals table is rebuilt. Rows are copied as they are: one the new checks
// refuse fails the upgrade instead of being dropped or changed. Copying in rowid order keeps `ORDER BY at, rowid`.
// `last_version` is the highest version number ever given, so a removed draft's number is never given again.
const SCHEMA_V4 = `
  ALTER TABLE proposals RENAME TO proposals_v3;
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
  INSERT INTO proposals
    (id, target, structure, item_id, kind, file, reason, base_version, status, agent_id, at, decided_at, problem, last_version)
    SELECT id, 'item', structure, item_id, kind, file, reason, base_version, status, agent_id, at, decided_at, problem, 1
    FROM proposals_v3 ORDER BY rowid;
  INSERT INTO proposal_versions (proposal_id, n, by, content, reason, at)
    SELECT id, 1, 'agent', json_object('fields', json(fields)), reason, at FROM proposals_v3 ORDER BY rowid;
  DROP TABLE proposals_v3;
  CREATE INDEX proposals_by_status ON proposals (status, at);
  CREATE INDEX proposals_by_agent ON proposals (agent_id, status);
`;

const SCHEMA_V5 = `
  ALTER TABLE item_counters RENAME COLUMN structure TO binder;
  ALTER TABLE proposals RENAME COLUMN structure TO binder;
`;

/** Brings a database at `version` to SCHEMA_VERSION; the caller runs it inside one transaction. Takes no seq. */
export const upgradeSchema = (db: DatabaseSync, version: number, newDbId: () => string) => {
  if (version < 1) {
    db.exec(SCHEMA_V1);
    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insertMeta.run("db_id", newDbId());
    insertMeta.run("seq", 0);
  }
  if (version < 2) db.exec(SCHEMA_V2);
  if (version < 3) db.exec(SCHEMA_V3);
  if (version < 4) {
    db.exec(SCHEMA_V4);
    // Outcomes reached before notes were delivered count as delivered (seq 0), so the next message doesn't carry
    // the whole history.
    db.prepare("UPDATE proposals SET noted_seq = 0 WHERE status IN (SELECT value FROM json_each(?))").run(JSON.stringify(OUTCOMES));
  }
  if (version < 5) db.exec(SCHEMA_V5);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
};
