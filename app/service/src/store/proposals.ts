import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Problem } from "@wombat/shared/items";
import { canRevise, INITIAL_STATUS, nextStatus, type FileProposalKind, type ItemProposalKind, type ProposalEvent, type ProposalStatus } from "@wombat/shared/proposals";

import { APPLYING, COUNTED_OPEN, draftSlot, isOutcome, OUTCOMES, settleEvent, type VersionAuthor } from "./proposal-rules.ts";
import { asNullableString, asNumber, asString, type DistributiveOmit } from "./values.ts";

export type FileEdit = { oldText: string; newText: string };

/** What one version proposes: a file's whole text (with the edits it came from, if any), or an item's fields. */
export type ProposalContent = { text: string; edits?: FileEdit[] } | { fields: Record<string, unknown> };

export type ProposalVersionRecord = { n: number; by: VersionAuthor; content: ProposalContent; reason: string; at: string };

/**
 * A proposal as stored. An item proposal names its item by id (`itemId`, null for a create until it's approved),
 * since handles change by hand. What it proposes lives in its versions.
 */
export type StoredProposal = {
  id: string;
  itemId: string | null;
  file: string | null;
  reason: string;
  /** The target's version the change is based on; null for a create. */
  baseVersion: string | null;
  status: ProposalStatus;
  agentId: string;
  at: string;
  /** When it last reached an outcome (OUTCOMES); absent while it has none. */
  decidedAt?: string;
  problem?: Problem;
  rejectReason?: string;
  /** What the write in progress will produce; only while it's being applied. */
  intent?: unknown;
} & (
  | { target: "file"; path: string; structure: null; kind: FileProposalKind }
  | { target: "item"; path: null; structure: string; kind: ItemProposalKind }
);

/** A proposal as handed to `insertProposal`: the store adds the id, `at` and the status. */
export type NewProposal = DistributiveOmit<StoredProposal, "id" | "status" | "at" | "decidedAt" | "problem" | "rejectReason" | "intent">;

/** A proposal write and the seq it took, to alert about once it's committed. */
export type ProposalChange = { proposal: StoredProposal; seq: number };

/** How a write that began with `beginApplying` ended; `itemId` names an approved create's new item. */
export type ApplyOutcome = { status: "approved"; itemId?: string } | { status: "conflict"; problem?: Problem } | { status: "pending" };

/**
 * Every write but `markDelivered` is one transaction that takes one seq; a refused one (an unknown id, a move the
 * contract doesn't allow, a version that's no longer current) returns undefined and takes none.
 */
export type ProposalStore = {
  insertProposal: (proposal: NewProposal, firstVersion: ProposalContent) => ProposalChange;
  /** From a conflict this resolves it back to pending; my draft stays in the list as history. */
  addAgentVersion: (id: string, content: ProposalContent, reason: string) => ProposalChange | undefined;
  /**
   * My edit of agent version `onVersion`, which must be the latest agent version. It gets a new number, replacing my
   * draft already on it; no number is ever given twice.
   */
  putDraft: (id: string, onVersion: number, content: ProposalContent) => ProposalChange | undefined;
  clearDraft: (id: string) => ProposalChange | undefined;
  /** `version` must be the current version; `intent` is JSON. */
  beginApplying: (id: string, version: number, intent: unknown) => ProposalChange | undefined;
  settle: (id: string, outcome: ApplyOutcome) => ProposalChange | undefined;
  rejectProposal: (id: string, reason?: string) => ProposalChange | undefined;
  /** Every proposal, or those with `status`, oldest first. */
  listProposals: (status?: ProposalStatus) => StoredProposal[];
  getProposal: (id: string) => StoredProposal | undefined;
  listVersions: (id: string) => ProposalVersionRecord[];
  countOpen: (agentId: string) => number;
  listApplying: () => StoredProposal[];
  /** The agent's proposals in OUTCOMES whose outcome it hasn't been told, oldest outcome first. */
  undeliveredOutcomes: (agentId: string) => StoredProposal[];
  /**
   * Marks the outcomes as delivered with log seq `seq`, taking no seq: call it inside the transaction that appends
   * that entry. Proposals no longer undelivered outcomes are skipped; returns how many were marked.
   */
  markDelivered: (ids: readonly string[], seq: number) => number;
};

type Transaction = <T>(fn: () => T) => T;

const contentFits = (target: StoredProposal["target"], content: ProposalContent) => (target === "file" ? "text" in content : "fields" in content);

const checkFits = (target: StoredProposal["target"], content: ProposalContent) => {
  if (!contentFits(target, content)) throw new Error(`${target === "file" ? "A file" : "An item"} proposal's version must hold ${target === "file" ? "text" : "fields"}.`);
};

const proposalOf = (row: Record<string, unknown>): StoredProposal => {
  const { decided_at: decidedAt, problem, reject_reason: rejectReason, intent } = row;
  const common = {
    id: asString(row.id),
    itemId: asNullableString(row.item_id),
    file: asNullableString(row.file),
    reason: asString(row.reason),
    baseVersion: asNullableString(row.base_version),
    status: asString(row.status) as ProposalStatus,
    agentId: asString(row.agent_id),
    at: asString(row.at),
    ...(decidedAt === null ? {} : { decidedAt: asString(decidedAt) }),
    ...(problem === null ? {} : { problem: JSON.parse(asString(problem)) as Problem }),
    ...(rejectReason === null ? {} : { rejectReason: asString(rejectReason) }),
    ...(intent === null ? {} : { intent: JSON.parse(asString(intent)) as unknown }),
  };
  const target = asString(row.target);
  if (target === "file") return { ...common, target, path: asString(row.path), structure: null, kind: asString(row.kind) as FileProposalKind };
  if (target === "item") return { ...common, target, path: null, structure: asString(row.structure), kind: asString(row.kind) as ItemProposalKind };
  throw new Error(`Unknown proposal target ${target} in the database.`);
};

/** What a status move writes besides the status; each move states all of it. */
type MoveColumns = { problem: string | null; rejectReason: string | null; intent: string | null; itemId: string | null };

export const openProposalStore = (db: DatabaseSync, transaction: Transaction, takeSeq: () => number, now: () => Date): ProposalStore => {
  const statements = {
    insert: db.prepare(
      `INSERT INTO proposals (id, target, path, structure, item_id, kind, file, reason, base_version, status, agent_id, at, last_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ),
    insertVersion: db.prepare("INSERT INTO proposal_versions (proposal_id, n, by, content, reason, at) VALUES (?, ?, ?, ?, ?, ?)"),
    takeVersionNumber: db.prepare("UPDATE proposals SET last_version = last_version + 1 WHERE id = ? RETURNING last_version"),
    deleteVersion: db.prepare("DELETE FROM proposal_versions WHERE proposal_id = ? AND n = ?"),
    versions: db.prepare("SELECT n, by, content, reason, at FROM proposal_versions WHERE proposal_id = ? ORDER BY n"),
    get: db.prepare("SELECT * FROM proposals WHERE id = ?"),
    list: db.prepare("SELECT * FROM proposals ORDER BY at, rowid"),
    listIn: db.prepare("SELECT * FROM proposals WHERE status IN (SELECT value FROM json_each(?)) ORDER BY at, rowid"),
    countIn: db.prepare("SELECT count(*) AS n FROM proposals WHERE agent_id = ? AND status IN (SELECT value FROM json_each(?))"),
    undelivered: db.prepare(
      `SELECT * FROM proposals WHERE agent_id = ? AND noted_seq IS NULL AND status IN (SELECT value FROM json_each(?))
       ORDER BY decided_at, rowid`,
    ),
    markDelivered: db.prepare(
      `UPDATE proposals SET noted_seq = ?
       WHERE id IN (SELECT value FROM json_each(?)) AND noted_seq IS NULL AND status IN (SELECT value FROM json_each(?))`,
    ),
    // Moving into any status clears `noted_seq`, so each outcome is delivered once, a later one too.
    move: db.prepare(
      `UPDATE proposals SET status = ?, decided_at = ?, problem = ?, reject_reason = ?, intent = ?,
         item_id = coalesce(?, item_id), noted_seq = NULL
       WHERE id = ? AND status = ? RETURNING *`,
    ),
  };

  const getProposal = (id: string) => {
    const row = statements.get.get(id);
    return row === undefined ? undefined : proposalOf(row);
  };

  const listVersions = (id: string): ProposalVersionRecord[] =>
    statements.versions.all(id).map((row) => ({
      n: asNumber(row.n),
      by: asString(row.by) as VersionAuthor,
      content: JSON.parse(asString(row.content)) as ProposalContent,
      reason: asString(row.reason),
      at: asString(row.at),
    }));

  const changed = (id: string): ProposalChange => {
    const proposal = getProposal(id);
    if (proposal === undefined) throw new Error(`Proposal ${id} vanished while it was being written.`);
    return { proposal, seq: takeSeq() };
  };

  /** Applies `event` to the proposal as read, guarded on that status still being stored. */
  const move = (stored: StoredProposal, event: ProposalEvent, columns: (stored: StoredProposal) => MoveColumns) => {
    const next = nextStatus(stored.status, event);
    if (next === undefined) return undefined;
    const { problem, rejectReason, intent, itemId } = columns(stored);
    const decidedAt = isOutcome(next) ? now().toISOString() : null;
    const row = statements.move.get(next, decidedAt, problem, rejectReason, intent, itemId, stored.id, stored.status);
    return row === undefined ? undefined : proposalOf(row);
  };

  /** A move as one transaction taking one seq, or undefined (nothing written) when `ready` or the move refuses. */
  const moving = (id: string, ready: (stored: StoredProposal) => boolean, event: ProposalEvent, columns: (stored: StoredProposal) => MoveColumns) =>
    transaction(() => {
      const stored = getProposal(id);
      if (stored === undefined || !ready(stored)) return undefined;
      return move(stored, event, columns) === undefined ? undefined : changed(id);
    });

  const takeVersionNumber = (id: string) => asNumber(statements.takeVersionNumber.get(id)?.last_version);

  const insertProposal = (proposal: NewProposal, firstVersion: ProposalContent) => {
    checkFits(proposal.target, firstVersion);
    const content = JSON.stringify(firstVersion);
    return transaction(() => {
      const id = randomUUID();
      const at = now().toISOString();
      statements.insert.run(
        id,
        proposal.target,
        proposal.path,
        proposal.structure,
        proposal.itemId,
        proposal.kind,
        proposal.file,
        proposal.reason,
        proposal.baseVersion,
        INITIAL_STATUS,
        proposal.agentId,
        at,
      );
      statements.insertVersion.run(id, 1, "agent", content, proposal.reason, at);
      return changed(id);
    });
  };

  /** The proposal while a new version may replace its current one, with its versions. */
  const revisable = (id: string, content: ProposalContent) => {
    const stored = getProposal(id);
    if (stored === undefined || !canRevise(stored.status)) return undefined;
    checkFits(stored.target, content);
    return { stored, versions: listVersions(id) };
  };

  const addAgentVersion = (id: string, content: ProposalContent, reason: string) =>
    transaction(() => {
      const found = revisable(id, content);
      if (found === undefined) return undefined;
      const { stored } = found;
      statements.insertVersion.run(id, takeVersionNumber(id), "agent", JSON.stringify(content), reason, now().toISOString());
      if (nextStatus(stored.status, "resolve") !== undefined) {
        const columns = () => ({ problem: null, rejectReason: null, intent: null, itemId: null });
        if (move(stored, "resolve", columns) === undefined) throw new Error(`Proposal ${id} changed while it was being revised.`);
      }
      return changed(id);
    });

  const putDraft = (id: string, onVersion: number, content: ProposalContent) =>
    transaction(() => {
      const found = revisable(id, content);
      const slot = found === undefined ? undefined : draftSlot(found.versions, onVersion);
      if (slot === undefined) return undefined;
      if (slot.replaces !== undefined) statements.deleteVersion.run(id, slot.replaces);
      statements.insertVersion.run(id, takeVersionNumber(id), "me", JSON.stringify(content), "", now().toISOString());
      return changed(id);
    });

  const clearDraft = (id: string) =>
    transaction(() => {
      const stored = getProposal(id);
      const current = listVersions(id).at(-1);
      if (stored === undefined || !canRevise(stored.status) || current?.by !== "me") return undefined;
      statements.deleteVersion.run(id, current.n);
      return changed(id);
    });

  const beginApplying = (id: string, version: number, intent: unknown) => {
    const intentText = JSON.stringify(intent);
    const columns = () => ({ problem: null, rejectReason: null, intent: intentText, itemId: null });
    return moving(id, () => listVersions(id).at(-1)?.n === version, "approve", columns);
  };

  const settle = (id: string, outcome: ApplyOutcome) =>
    transaction(() => {
      const stored = getProposal(id);
      const event = stored === undefined ? undefined : settleEvent(stored.status, outcome.status);
      if (stored === undefined || event === undefined) return undefined;
      const columns = () => ({
        problem: "problem" in outcome && outcome.problem !== undefined ? JSON.stringify(outcome.problem) : null,
        rejectReason: null,
        intent: null,
        itemId: "itemId" in outcome ? (outcome.itemId ?? null) : null,
      });
      return move(stored, event, columns) === undefined ? undefined : changed(id);
    });

  const rejectProposal = (id: string, reason?: string) =>
    moving(id, () => true, "reject", (stored) => ({
      problem: stored.problem === undefined ? null : JSON.stringify(stored.problem),
      rejectReason: reason ?? null,
      intent: null,
      itemId: null,
    }));

  const listProposals = (status?: ProposalStatus) =>
    (status === undefined ? statements.list.all() : statements.listIn.all(JSON.stringify([status]))).map(proposalOf);

  return {
    insertProposal,
    addAgentVersion,
    putDraft,
    clearDraft,
    beginApplying,
    settle,
    rejectProposal,
    listProposals,
    getProposal,
    listVersions,
    countOpen: (agentId) => asNumber(statements.countIn.get(agentId, JSON.stringify(COUNTED_OPEN))?.n),
    listApplying: () => statements.listIn.all(JSON.stringify(APPLYING)).map(proposalOf),
    undeliveredOutcomes: (agentId) => statements.undelivered.all(agentId, JSON.stringify(OUTCOMES)).map(proposalOf),
    markDelivered: (ids, seq) =>
      transaction(() => Number(statements.markDelivered.run(seq, JSON.stringify(ids), JSON.stringify(OUTCOMES)).changes)),
  };
};
