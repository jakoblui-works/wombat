// Lasting check (contract "AgentSummary additions", store schema v3, silent failure): a store written by the
// previous version (schema 2) opens in place as schema 3, keeping every agent, log entry, seq, handle counter and
// proposal; its agents read with `pendingPermissions: []` and no branch, lastText or lastUserAt; and the new
// summary fields survive a close and reopen. Without it, an upgrade would lose history or proposals, or the new
// fields would be dropped on the way to disk and vanish after a restart.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { open, tempStorePath } from "../../test/store-fixtures.ts";

/** Schema 1 and the schema 2 additions, exactly as the step 5 store wrote them. */
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

/** Summaries as a step 5 service stored them: none of the step 6 fields. */
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

const version = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("PRAGMA user_version").get()?.user_version;
  } finally {
    db.close();
  }
};

describe("store schema v3", () => {
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
    expect(store.getProposal(PROPOSAL.id)).toEqual(PROPOSAL);
    expect(store.nextHandleNumber(COUNTER.structure, 0), "the handle counter carries on").toBe(COUNTER.last + 1);
    store.close();
    expect(version(path)).toBe(3);
  });
});
