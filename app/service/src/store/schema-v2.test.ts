// Lasting check (contract "Store schema v2", silent failure): a store written by schema 1 opens in place as
// the current schema, keeping every agent and log entry, and gains `item_counters` and
// `proposals`; a fresh store has both; reopening it changes nothing. Without it, an upgrade would lose
// the agents' history or leave a table missing until the first proposal fails.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { open, summary, tempStorePath } from "../../test/store-fixtures.ts";

/** Schema 1 exactly as the first released store wrote it. */
const V1_SCHEMA = `
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

const DB_ID = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const AGENTS = [summary("a1", { repo: "site-web" }), summary("a2", { repo: "api", state: "stopped" })];
const ENTRIES = [
  { seq: 2, agentId: "a1", body: { type: "user_message", text: "Fix the footer link", commandId: "cmd_1", at: "2026-11-08T10:00:00.000Z" } },
  {
    seq: 3,
    agentId: "a1",
    body: { type: "session_update", at: "2026-11-08T10:00:01.000Z", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "On it." } } },
  },
  { seq: 5, agentId: "a2", body: { type: "turn_ended", at: "2026-11-08T10:05:00.000Z", stopReason: "end_turn" } },
];
const LAST_SEQ = 6;

/** Writes a schema 1 database with two agents and their log, as a step 4 service left it. */
const writeV1Store = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec(V1_SCHEMA);
  db.prepare("INSERT INTO meta (key, value) VALUES ('db_id', ?), ('seq', ?)").run(DB_ID, LAST_SEQ);
  for (const agent of AGENTS) {
    // A v1 summary had no pendingPermissions; the store reads it back as [].
    const v1Summary = JSON.stringify(agent, (key, value: unknown) => (key === "pendingPermissions" ? undefined : value));
    db.prepare("INSERT INTO agents (id, started_at, summary) VALUES (?, ?, ?)").run(agent.id, agent.startedAt, v1Summary);
  }
  for (const { seq, agentId, body } of ENTRIES) {
    const text = JSON.stringify(body);
    db.prepare("INSERT INTO log_entries (seq, agent_id, bytes, body) VALUES (?, ?, ?, ?)").run(seq, agentId, Buffer.byteLength(text), text);
    db.prepare("UPDATE agents SET log_bytes = log_bytes + ? WHERE id = ?").run(Buffer.byteLength(text), agentId);
  }
  db.exec("PRAGMA user_version = 1");
  db.close();
};

/** The schema version and the tables of the file, read directly. */
const inspect = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    const counterColumns = db
      .prepare("PRAGMA table_info(item_counters)")
      .all()
      .map((row) => String(row.name));
    return { version, tables, counterColumns };
  } finally {
    db.close();
  }
};

/** The current schema: v1 migrates through v2 to it, with the v2 tables. */
const expectCurrentSchema = (path: string) => {
  const { version, tables, counterColumns } = inspect(path);
  expect(version).toBe(3);
  expect(tables).toEqual(expect.arrayContaining(["meta", "agents", "log_entries", "item_counters", "proposals"]));
  expect(counterColumns.sort()).toEqual(["last", "structure"]);
};

describe("store schema v2", () => {
  test("a v1 store migrates in place to the current schema and keeps every agent, entry, seq and its db id", () => {
    const path = tempStorePath();
    mkdirSync(dirname(path), { recursive: true });
    writeV1Store(path);

    const store = open({ path });

    expect(store.dbId).toBe(DB_ID);
    expect(store.currentSeq()).toBe(LAST_SEQ);
    expect(store.listAgents()).toEqual(AGENTS);
    expect(store.readLog("a1").entries.map(({ seq, type }) => ({ seq, type }))).toEqual([
      { seq: 2, type: "user_message" },
      { seq: 3, type: "session_update" },
    ]);
    expect(store.readLog("a2").entries.map((entry) => entry.seq)).toEqual([5]);
    store.close();
    expectCurrentSchema(path);
  });

  test("a fresh store has the current schema with the v2 tables, and reopening it changes nothing", () => {
    const path = tempStorePath();
    const first = open({ path });
    first.putAgent(summary("a1"));
    const { dbId } = first;
    const seq = first.currentSeq();
    first.close();
    expectCurrentSchema(path);

    const again = open({ path });

    expect(again.dbId).toBe(dbId);
    expect(again.currentSeq()).toBe(seq);
    expect(again.listAgents().map((agent) => agent.id)).toEqual(["a1"]);
    again.close();
    expectCurrentSchema(path);
  });
});
