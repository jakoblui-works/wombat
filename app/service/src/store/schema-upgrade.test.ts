// A store written by an older version opens in place as the current schema, or stays exactly as it was. From
// schema 2: every agent, log entry, seq, handle counter and proposal is kept; its agents read with
// `pendingPermissions: []` and no branch, lastText or lastUserAt. From schema 3: every proposal becomes an item
// proposal with one agent version, and the outcomes it already had aren't told to the agent again. Without it, an
// upgrade would lose history or proposals, leave a half-upgraded file behind, or make the first message after an
// update carry every old outcome.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { open, summary, tempStorePath } from "../../test/store-fixtures.ts";
import { SCHEMA_VERSION } from "./schema.ts";

/** Schema 1 and the schema 2 additions, exactly as that store wrote them; schema 3 changed no table. */
const V2_SCHEMA = `
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

const DB_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Summaries as a schema 2 service stored them: none of the later fields. */
const V2_AGENTS = [
  {
    id: "a1",
    harness: "claude-code",
    repo: "site-web",
    state: "stopped",
    sessionId: "sess-a1",
    title: "Rename the footer link",
    capabilities: { loadSession: false },
    startedAt: "2026-11-08T09:00:00.000Z",
    lastActivityAt: "2026-11-08T09:05:00.000Z",
  },
  {
    id: "a2",
    harness: "claude-code",
    repo: "api",
    state: "error",
    sessionId: "sess-a2",
    capabilities: { loadSession: true },
    startedAt: "2026-11-08T10:00:00.000Z",
    lastActivityAt: "2026-11-08T10:01:00.000Z",
    error: { code: "agent_failed", message: "The agent process ended during a turn." },
  },
];
const ENTRIES = [
  { seq: 2, agentId: "a1", body: { type: "user_message", text: "Rename the footer link to Imprint", commandId: "cmd_1", at: "2026-11-08T09:01:00.000Z" } },
  {
    seq: 3,
    agentId: "a1",
    body: { type: "session_update", at: "2026-11-08T09:01:01.000Z", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } },
  },
  { seq: 6, agentId: "a2", body: { type: "turn_ended", at: "2026-11-08T10:01:00.000Z", stopReason: "end_turn" } },
];
const PROPOSAL = {
  id: "0196f3c2-1a00-7000-8000-0000000000aa",
  structure: "bugs",
  itemId: "0196f3c2-1a00-7000-8000-000000000002",
  kind: "update" as const,
  fields: { note: "Seen again on mobile" },
  file: null,
  reason: "Reported twice",
  baseVersion: "abc123",
  status: "pending" as const,
  agentId: "a1",
  at: "2026-11-08T09:03:00.000Z",
};
const COUNTER = { structure: "bugs", last: 41 };
const LAST_SEQ = 9;

/** Writes a schema 2 database with two agents, their log, a handle counter and a pending proposal. */
const writeV2Store = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec(V2_SCHEMA);
  db.prepare("INSERT INTO meta (key, value) VALUES ('db_id', ?), ('seq', ?)").run(DB_ID, LAST_SEQ);
  for (const agent of V2_AGENTS) {
    db.prepare("INSERT INTO agents (id, started_at, summary) VALUES (?, ?, ?)").run(agent.id, agent.startedAt, JSON.stringify(agent));
  }
  for (const { seq, agentId, body } of ENTRIES) {
    const text = JSON.stringify(body);
    db.prepare("INSERT INTO log_entries (seq, agent_id, bytes, body) VALUES (?, ?, ?, ?)").run(seq, agentId, Buffer.byteLength(text), text);
    db.prepare("UPDATE agents SET log_bytes = log_bytes + ? WHERE id = ?").run(Buffer.byteLength(text), agentId);
  }
  db.prepare("INSERT INTO item_counters (structure, last) VALUES (?, ?)").run(COUNTER.structure, COUNTER.last);
  db.prepare(
    `INSERT INTO proposals (id, structure, item_id, kind, fields, file, reason, base_version, status, agent_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    PROPOSAL.id,
    PROPOSAL.structure,
    PROPOSAL.itemId,
    PROPOSAL.kind,
    JSON.stringify(PROPOSAL.fields),
    PROPOSAL.file,
    PROPOSAL.reason,
    PROPOSAL.baseVersion,
    PROPOSAL.status,
    PROPOSAL.agentId,
    PROPOSAL.at,
  );
  db.exec("PRAGMA user_version = 2");
  db.close();
};

/** Reads the file without the store. */
const raw = <T>(path: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
};

const version = (path: string) => raw(path, (db) => db.prepare("PRAGMA user_version").get()?.user_version);

type V3Row = Omit<typeof PROPOSAL, "kind" | "status" | "itemId" | "fields" | "file" | "baseVersion"> & {
  itemId: string | null;
  file: string | null;
  kind: "create" | "update" | "delete";
  fields: Record<string, unknown>;
  baseVersion: string | null;
  status: string;
  decidedAt?: string;
  problem?: { message: string };
};

/** A proposal in each status schema 3 had; agent a2 has one of each. */
const V3_ROWS: V3Row[] = [
  { ...PROPOSAL, id: "0196f3c2-1a00-7000-8000-0000000000a1" },
  {
    id: "0196f3c2-1a00-7000-8000-0000000000a2",
    structure: "bugs",
    itemId: "0196f3c2-1a00-7000-8000-000000000012",
    kind: "create",
    fields: { title: "Search returns stale results", repo: "api" },
    file: "notes/search.md",
    reason: "Found while testing",
    baseVersion: null,
    status: "approved",
    agentId: "a2",
    at: "2026-11-10T09:00:00.000Z",
    decidedAt: "2026-11-10T09:10:00.000Z",
  },
  {
    id: "0196f3c2-1a00-7000-8000-0000000000a3",
    structure: "bugs",
    itemId: "0196f3c2-1a00-7000-8000-000000000013",
    kind: "delete",
    fields: {},
    file: null,
    reason: "Duplicate of the footer bug",
    baseVersion: "77aa01",
    status: "rejected",
    agentId: "a2",
    at: "2026-11-10T10:00:00.000Z",
    decidedAt: "2026-11-10T10:05:00.000Z",
  },
  {
    id: "0196f3c2-1a00-7000-8000-0000000000a4",
    structure: "bugs",
    itemId: "0196f3c2-1a00-7000-8000-000000000014",
    kind: "update",
    fields: { note: "klein – 2 Punkte" },
    file: null,
    reason: "Only on one old browser",
    baseVersion: "c0ffee",
    status: "conflict",
    agentId: "a2",
    at: "2026-11-10T11:00:00.000Z",
    decidedAt: "2026-11-10T11:01:00.000Z",
    problem: { message: "The item changed since it was proposed. Ask the agent to propose it again." },
  },
  {
    id: "0196f3c2-1a00-7000-8000-0000000000a5",
    structure: "backlog",
    itemId: null,
    kind: "create",
    fields: { title: "Standup notes" },
    file: null,
    reason: "Daily notes",
    baseVersion: null,
    status: "pending",
    agentId: "a2",
    at: "2026-11-10T11:30:00.000Z",
  },
];

/**
 * Writes a schema 3 database in WAL mode, as that store left it, so opening it changes no byte before the upgrade
 * starts. `damaged` adds, last, a row whose status no status check admits.
 */
const writeV3Store = (path: string, { damaged = false } = {}) => {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(V2_SCHEMA);
  db.prepare("INSERT INTO meta (key, value) VALUES ('db_id', ?), ('seq', ?)").run(DB_ID, LAST_SEQ);
  for (const agent of [summary("a1"), summary("a2")]) {
    db.prepare("INSERT INTO agents (id, started_at, summary) VALUES (?, ?, ?)").run(agent.id, agent.startedAt, JSON.stringify(agent));
  }
  const insert = db.prepare(
    `INSERT INTO proposals (id, structure, item_id, kind, fields, file, reason, base_version, status, agent_id, at, decided_at, problem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = (row: V3Row) =>
    insert.run(
      row.id,
      row.structure,
      row.itemId,
      row.kind,
      JSON.stringify(row.fields),
      row.file,
      row.reason,
      row.baseVersion,
      row.status,
      row.agentId,
      row.at,
      row.decidedAt ?? null,
      row.problem === undefined ? null : JSON.stringify(row.problem),
    );
  for (const row of V3_ROWS) write(row);
  if (damaged) {
    db.exec("PRAGMA ignore_check_constraints = ON");
    write({ ...PROPOSAL, id: "0196f3c2-1a00-7000-8000-0000000000ff", status: "archived" });
  }
  db.exec("PRAGMA user_version = 3");
  db.close();
};

describe("opening a store an older version wrote", () => {
  test("a v2 store migrates in place: agents read with no pending permissions and no new fields, the rest intact", () => {
    const path = tempStorePath();
    mkdirSync(dirname(path), { recursive: true });
    writeV2Store(path);

    const store = open({ path });

    expect(store.dbId).toBe(DB_ID);
    expect(store.currentSeq()).toBe(LAST_SEQ);
    // Strict: branch, lastText and lastUserAt must be absent, not present as undefined or null.
    expect(store.listAgents()).toStrictEqual(V2_AGENTS.map((agent) => ({ ...agent, pendingPermissions: [] })));
    expect(store.readLog("a1").entries.map(({ seq, type }) => ({ seq, type }))).toEqual([
      { seq: 2, type: "user_message" },
      { seq: 3, type: "session_update" },
    ]);
    expect(store.readLog("a2").entries.map((entry) => entry.seq)).toEqual([6]);
    const { fields, ...stored } = PROPOSAL;
    expect(store.getProposal(PROPOSAL.id)).toEqual({ ...stored, target: "item", path: null });
    expect(store.listVersions(PROPOSAL.id).map((version) => version.content)).toEqual([{ fields }]);
    expect(store.nextHandleNumber(COUNTER.structure, 0), "the handle counter carries on").toBe(COUNTER.last + 1);
    store.close();
    expect(version(path)).toBe(4);
  });

  test("a v3 store's proposals each become an item proposal with one agent version holding its fields, the rest intact", () => {
    const path = tempStorePath();
    writeV3Store(path);

    const store = open({ path });

    expect(store.listProposals().map((proposal) => proposal.id)).toEqual(V3_ROWS.map((row) => row.id));
    for (const { fields, ...row } of V3_ROWS) {
      expect(store.getProposal(row.id), `the ${row.status} proposal`).toStrictEqual({ ...row, target: "item", path: null });
      expect(store.listVersions(row.id), `the ${row.status} proposal's versions`).toEqual([{ n: 1, by: "agent", content: { fields }, reason: row.reason, at: row.at }]);
    }
    expect(store.currentSeq(), "the upgrade takes no seq").toBe(LAST_SEQ);
    store.close();
    expect(version(path)).toBe(SCHEMA_VERSION);
  });

  test("outcomes a v3 store already held aren't undelivered after the upgrade; one reached after it is", () => {
    const path = tempStorePath();
    writeV3Store(path);
    const store = open({ path });
    const pending = V3_ROWS.find((row) => row.agentId === "a2" && row.status === "pending");

    expect(store.undeliveredOutcomes("a2")).toEqual([]);

    store.rejectProposal(pending?.id ?? "", "Not needed");
    expect(store.undeliveredOutcomes("a2").map((proposal) => proposal.id)).toEqual([pending?.id]);
  });

  test("an upgrade that fails midway leaves the file as it was, byte for byte", () => {
    const path = tempStorePath();
    writeV3Store(path, { damaged: true });
    const before = readFileSync(path);
    const tables = (db: DatabaseSync) => db.prepare("SELECT name, sql FROM sqlite_schema ORDER BY name").all();
    const tablesBefore = raw(path, tables);

    // The last row fits no status check, so copying the rows fails after the upgrade has rebuilt the table.
    expect(() => open({ path })).toThrow(/CHECK constraint/);

    expect(readFileSync(path).equals(before), "the database file is the same").toBe(true);
    expect(existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`).length : 0, "nothing of the upgrade waits in the WAL").toBe(0);
    expect(version(path)).toBe(3);
    expect(raw(path, tables)).toEqual(tablesBefore);
  });
});
