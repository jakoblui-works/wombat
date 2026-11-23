import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Problem } from "@wombat/shared/items";
import { canDraft, canRevise, INITIAL_STATUS, myDraft, nextStatus, type FileProposalKind, type ItemProposalKind, type ProposalEvent, type ProposalStatus } from "@wombat/shared/proposals";

import { APPLYING, awaitsNewVersion, COUNTED_OPEN, currentVersion, draftSlot, isOutcome, OUTCOMES, settleEvent, type VersionAuthor } from "./proposal-rules.ts";
import { asNullableString, asNumber, asString, type DistributiveOmit } from "./values.ts";

export type FileEdit = { oldText: string; newText: string };

/** What one version proposes: a file's whole text (with the edits it came from, if any), or an item's fields. */
export type ProposalContent = { text: string; edits?: FileEdit[] } | { fields: Record<string, unknown> };

export type TextContent = Extract<ProposalContent, { text: string }>;

/** A file proposal's version content; throws for an item's (a caller bug). */
export const textOf = (content: ProposalContent): TextContent => {
  if (!("text" in content)) throw new Error("A file proposal's version must hold text, not an item's fields.");
  return content;
};

/** An item proposal's version fields; throws for a file's text (a caller bug). */
export const fieldsOf = (content: ProposalContent): Record<string, unknown> => {
  if (!("fields" in content)) throw new Error("An item proposal's version must hold fields, not a file's text.");
  return content.fields;
};

export type ProposalVersionRecord = { n: number; by: VersionAuthor; content: ProposalContent; reason: string; at: string };

export type ProposalVersionHead = Omit<ProposalVersionRecord, "content">;

/**
 * A proposal as stored. An item proposal names its item by id (`itemId`, null for a create until it's approved),
 * since handles change by hand. What it proposes lives in its versions.
 */
export type StoredProposal = {
  id: string;
  /** The workspace the proposal belongs to: its agent's. */
  workspace: string;
  itemId: string | null;
  /** The item's handle as the applying commit found it, so an approved delete still names its item; absent before. */
  itemHandle?: string;
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
  | { target: "file"; path: string; binder: null; kind: FileProposalKind }
  | { target: "item"; path: null; binder: string; kind: ItemProposalKind }
);

/** A proposal as handed to `insertProposal`: the store adds the id, `at` and the status. */
export type NewProposal = DistributiveOmit<StoredProposal, "id" | "itemHandle" | "status" | "at" | "decidedAt" | "problem" | "rejectReason" | "intent">;

/** A new proposal as its checks build it; the proposals module's `insert` adds the workspace. */
export type ProposalForInsert = DistributiveOmit<NewProposal, "workspace">;

/** A proposal write and the seq it took, to alert about once it's committed. */
export type ProposalChange = { proposal: StoredProposal; seq: number };

/** How a write that began with `beginApplying` ended; `itemId` and `itemHandle` name an approved create's new item. */
export type ApplyOutcome = { status: "approved"; itemId?: string; itemHandle?: string } | { status: "conflict"; problem?: Problem } | { status: "pending"; problem?: Problem };

/**
 * Every write but `markDelivered` is one transaction that takes one seq; a refused one (an unknown id, a move the
 * contract doesn't allow, a version that's no longer current) returns undefined and takes none.
 */
export type ProposalStore = {
  insertProposal: (proposal: NewProposal, firstVersion: ProposalContent) => ProposalChange;
  /**
   * From a conflict this resolves it back to pending; my draft stays in the list as history. A pending proposal's
   * stored problem goes too. A given `baseVersion` becomes the proposal's base; undefined keeps it.
   */
  addAgentVersion: (id: string, content: ProposalContent, reason: string, baseVersion?: string | null) => ProposalChange | undefined;
  /**
   * My edit of agent version `onVersion`, which must be the latest agent version. It gets a new number, replacing my
   * draft already on it; no number is ever given twice. Only while pending (`canDraft`); a stored problem goes.
   */
  putDraft: (id: string, onVersion: number, content: ProposalContent) => ProposalChange | undefined;
  /** Drops my current draft, only while pending (`canDraft`). */
  clearDraft: (id: string) => ProposalChange | undefined;
  /** `version` must be the current version; `intent` is JSON. A given `itemHandle` replaces the stored one. */
  beginApplying: (id: string, version: number, intent: unknown, itemHandle?: string | null) => ProposalChange | undefined;
  settle: (id: string, outcome: ApplyOutcome) => ProposalChange | undefined;
  /**
   * Settles a write that began with `beginApplying` back to pending, nothing written, with `content` as a new agent
   * version whose target version is `baseVersion` (the proposal's base from then on).
   */
  settleRevised: (id: string, content: ProposalContent, reason: string, baseVersion: string | null) => ProposalChange | undefined;
  rejectProposal: (id: string, reason?: string) => ProposalChange | undefined;
  /** Every proposal, or those with `status`, oldest first. */
  listProposals: (status?: ProposalStatus) => StoredProposal[];
  getProposal: (id: string) => StoredProposal | undefined;
  listVersions: (id: string) => ProposalVersionRecord[];
  /** Version `n` with its content, undefined when it isn't stored. */
  getVersion: (id: string, n: number) => ProposalVersionRecord | undefined;
  /** listVersions without reading any content. */
  listVersionHeads: (id: string) => ProposalVersionHead[];
  countOpen: (agentId: string) => number;
  listApplying: () => StoredProposal[];
  /** The agent's proposals in OUTCOMES whose outcome it hasn't been told, oldest outcome first. */
  undeliveredOutcomes: (agentId: string) => StoredProposal[];
  /**
   * Delivered means the prompt of the note stored as log seq `seq` was handed to the agent, or may have been. Marks
   * the outcomes so, taking no seq: call it inside the transaction that appends that note. Proposals no longer
   * undelivered outcomes are skipped; returns how many were marked.
   */
  markDelivered: (ids: readonly string[], seq: number) => number;
  /**
   * The note stored as log seq `seq` is known never to have reached the agent: its outcomes are undelivered again.
   * Takes no seq; call it inside the transaction that appends the entry saying so. Returns how many were cleared.
   */
  markNotDelivered: (seq: number) => number;
};

type Transaction = <T>(fn: () => T) => T;

const checkFits = (target: StoredProposal["target"], content: ProposalContent) => {
  if (target === "file") textOf(content);
  else fieldsOf(content);
};

const proposalOf = (row: Record<string, unknown>): StoredProposal => {
  const { decided_at: decidedAt, problem, reject_reason: rejectReason, intent, item_handle: itemHandle } = row;
  const common = {
    id: asString(row.id),
    workspace: asString(row.workspace),
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
    ...(itemHandle === null ? {} : { itemHandle: asString(itemHandle) }),
    ...(intent === null ? {} : { intent: JSON.parse(asString(intent)) as unknown }),
  };
  const target = asString(row.target);
  if (target === "file") return { ...common, target, path: asString(row.path), binder: null, kind: asString(row.kind) as FileProposalKind };
  if (target === "item") return { ...common, target, path: null, binder: asString(row.binder), kind: asString(row.kind) as ItemProposalKind };
  throw new Error(`Unknown proposal target ${target} in the database.`);
};

/** What a status move writes besides the status; each move states all of it. */
type MoveColumns = { problem: string | null; rejectReason: string | null; intent: string | null; itemId: string | null; itemHandle?: string | null };

export const openProposalStore = (db: DatabaseSync, transaction: Transaction, takeSeq: () => number, now: () => Date): ProposalStore => {
  const statements = {
    insert: db.prepare(
      `INSERT INTO proposals (id, workspace, target, path, binder, item_id, kind, file, reason, base_version, status, agent_id, at, last_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ),
    insertVersion: db.prepare("INSERT INTO proposal_versions (proposal_id, n, by, content, reason, at) VALUES (?, ?, ?, ?, ?, ?)"),
    setBase: db.prepare("UPDATE proposals SET base_version = ? WHERE id = ?"),
    clearProblem: db.prepare("UPDATE proposals SET problem = NULL WHERE id = ?"),
    takeVersionNumber: db.prepare("UPDATE proposals SET last_version = last_version + 1 WHERE id = ? RETURNING last_version"),
    deleteVersion: db.prepare("DELETE FROM proposal_versions WHERE proposal_id = ? AND n = ?"),
    versions: db.prepare("SELECT n, by, content, reason, at FROM proposal_versions WHERE proposal_id = ? ORDER BY n"),
    version: db.prepare("SELECT n, by, content, reason, at FROM proposal_versions WHERE proposal_id = ? AND n = ?"),
    versionHeads: db.prepare("SELECT n, by, reason, at FROM proposal_versions WHERE proposal_id = ? ORDER BY n"),
    // Every read of proposals leaves out those without a workspace (stored before workspaces existed).
    get: db.prepare("SELECT * FROM proposals WHERE id = ? AND workspace IS NOT NULL"),
    list: db.prepare("SELECT * FROM proposals WHERE workspace IS NOT NULL ORDER BY at, rowid"),
    listIn: db.prepare("SELECT * FROM proposals WHERE workspace IS NOT NULL AND status IN (SELECT value FROM json_each(?)) ORDER BY at, rowid"),
    countIn: db.prepare("SELECT count(*) AS n FROM proposals WHERE agent_id = ? AND status IN (SELECT value FROM json_each(?))"),
    undelivered: db.prepare(
      `SELECT * FROM proposals WHERE agent_id = ? AND workspace IS NOT NULL AND noted_seq IS NULL AND status IN (SELECT value FROM json_each(?))
       ORDER BY decided_at, rowid`,
    ),
    markDelivered: db.prepare(
      `UPDATE proposals SET noted_seq = ?
       WHERE id IN (SELECT value FROM json_each(?)) AND noted_seq IS NULL AND status IN (SELECT value FROM json_each(?))`,
    ),
    markNotDelivered: db.prepare("UPDATE proposals SET noted_seq = NULL WHERE noted_seq = ?"),
    // Moving into any status clears `noted_seq`, so each outcome is delivered once, a later one too.
    move: db.prepare(
      `UPDATE proposals SET status = ?, decided_at = ?, problem = ?, reject_reason = ?, intent = ?,
         item_id = coalesce(?, item_id), item_handle = coalesce(?, item_handle), noted_seq = NULL
       WHERE id = ? AND status = ? RETURNING *`,
    ),
  };

  const getProposal = (id: string) => {
    const row = statements.get.get(id);
    return row === undefined ? undefined : proposalOf(row);
  };

  const headOf = (row: Record<string, unknown>): ProposalVersionHead => ({
    n: asNumber(row.n),
    by: asString(row.by) as VersionAuthor,
    reason: asString(row.reason),
    at: asString(row.at),
  });

  const listVersionHeads = (id: string): ProposalVersionHead[] => statements.versionHeads.all(id).map(headOf);

  const recordOf = (row: Record<string, unknown>): ProposalVersionRecord => ({ ...headOf(row), content: JSON.parse(asString(row.content)) as ProposalContent });

  const listVersions = (id: string): ProposalVersionRecord[] => statements.versions.all(id).map(recordOf);

  const getVersion = (id: string, n: number): ProposalVersionRecord | undefined => {
    const row = statements.version.get(id, n);
    return row === undefined ? undefined : recordOf(row);
  };

  const changed = (id: string): ProposalChange => {
    const proposal = getProposal(id);
    if (proposal === undefined) throw new Error(`Proposal ${id} vanished while it was being written.`);
    return { proposal, seq: takeSeq() };
  };

  /** Applies `event` to the proposal as read, guarded on that status still being stored. */
  const move = (stored: StoredProposal, event: ProposalEvent, columns: (stored: StoredProposal) => MoveColumns) => {
    const next = nextStatus(stored.status, event);
    if (next === undefined) return undefined;
    const { problem, rejectReason, intent, itemId, itemHandle = null } = columns(stored);
    const decidedAt = isOutcome(next) ? now().toISOString() : null;
    const row = statements.move.get(next, decidedAt, problem, rejectReason, intent, itemId, itemHandle, stored.id, stored.status);
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
        proposal.workspace,
        proposal.target,
        proposal.path,
        proposal.binder,
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

  /** The proposal while `allows` its status for a new version, with its versions' heads. */
  const revisable = (id: string, content: ProposalContent, allows: (status: ProposalStatus) => boolean) => {
    const stored = getProposal(id);
    if (stored === undefined || !allows(stored.status)) return undefined;
    checkFits(stored.target, content);
    return { stored, versions: listVersionHeads(id) };
  };

  const addAgentVersion = (id: string, content: ProposalContent, reason: string, baseVersion?: string | null) =>
    transaction(() => {
      const found = revisable(id, content, canRevise);
      if (found === undefined) return undefined;
      const { stored } = found;
      statements.insertVersion.run(id, takeVersionNumber(id), "agent", JSON.stringify(content), reason, now().toISOString());
      if (baseVersion !== undefined) statements.setBase.run(baseVersion, id);
      if (awaitsNewVersion(stored.status)) {
        const columns = () => ({ problem: null, rejectReason: null, intent: null, itemId: null });
        if (move(stored, "resolve", columns) === undefined) throw new Error(`Proposal ${id} changed while it was being revised.`);
      } else statements.clearProblem.run(id);
      return changed(id);
    });

  const putDraft = (id: string, onVersion: number, content: ProposalContent) =>
    transaction(() => {
      const found = revisable(id, content, canDraft);
      const slot = found === undefined ? undefined : draftSlot(found.versions, onVersion);
      if (found === undefined || slot === undefined) return undefined;
      if (slot.replaces !== undefined) statements.deleteVersion.run(id, slot.replaces);
      statements.insertVersion.run(id, takeVersionNumber(id), "me", JSON.stringify(content), "", now().toISOString());
      statements.clearProblem.run(id);
      return changed(id);
    });

  const clearDraft = (id: string) =>
    transaction(() => {
      const stored = getProposal(id);
      const draft = myDraft(listVersionHeads(id));
      if (stored === undefined || !canDraft(stored.status) || draft === undefined) return undefined;
      statements.deleteVersion.run(id, draft.mine.n);
      return changed(id);
    });

  const beginApplying = (id: string, version: number, intent: unknown, itemHandle: string | null = null) => {
    const intentText = JSON.stringify(intent);
    const columns = () => ({ problem: null, rejectReason: null, intent: intentText, itemId: null, itemHandle });
    return moving(id, () => currentVersion(listVersionHeads(id))?.n === version, "approve", columns);
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
        itemHandle: "itemHandle" in outcome ? (outcome.itemHandle ?? null) : null,
      });
      return move(stored, event, columns) === undefined ? undefined : changed(id);
    });

  const settleRevised = (id: string, content: ProposalContent, reason: string, baseVersion: string | null) =>
    transaction(() => {
      const stored = getProposal(id);
      const event = stored === undefined ? undefined : settleEvent(stored.status, "pending");
      if (stored === undefined || event === undefined) return undefined;
      checkFits(stored.target, content);
      const columns = () => ({ problem: null, rejectReason: null, intent: null, itemId: null });
      if (move(stored, event, columns) === undefined) return undefined;
      statements.insertVersion.run(id, takeVersionNumber(id), "agent", JSON.stringify(content), reason, now().toISOString());
      statements.setBase.run(baseVersion, id);
      return changed(id);
    });

  // Only a conflict's problem stays: a pending proposal's (a retry's) says to approve again, which no longer applies.
  const rejectProposal = (id: string, reason?: string) =>
    moving(id, () => true, "reject", (stored) => ({
      problem: stored.problem === undefined || !awaitsNewVersion(stored.status) ? null : JSON.stringify(stored.problem),
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
    settleRevised,
    rejectProposal,
    listProposals,
    getProposal,
    listVersions,
    getVersion,
    listVersionHeads,
    countOpen: (agentId) => asNumber(statements.countIn.get(agentId, JSON.stringify(COUNTED_OPEN))?.n),
    listApplying: () => statements.listIn.all(JSON.stringify(APPLYING)).map(proposalOf),
    undeliveredOutcomes: (agentId) => statements.undelivered.all(agentId, JSON.stringify(OUTCOMES)).map(proposalOf),
    markDelivered: (ids, seq) =>
      transaction(() => Number(statements.markDelivered.run(seq, JSON.stringify(ids), JSON.stringify(OUTCOMES)).changes)),
    // 0 marks the outcomes from before the note existed, which are never told.
    markNotDelivered: (seq) => (seq > 0 ? transaction(() => Number(statements.markNotDelivered.run(seq).changes)) : 0),
  };
};
