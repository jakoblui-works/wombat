// Proposals: changes an agent proposed to a plain file or an item, kept by the service until the user approves or
// rejects them in the app. Request bodies are strict, responses lenient, as in `api.ts`. This module owns the status
// moves and the predicates on a status: the service and the app ask nextStatus and the predicates below, never
// compare statuses themselves.
import { z } from "zod";

import { Item, Problem } from "./items.ts";
import { queryInt } from "./query.ts";

/** An ISO date-time with its offset, as every timestamp on the wire. */
export const Timestamp = z.iso.datetime({ offset: true });

/** The most proposals one agent may have counting toward the cap (countsTowardCap: pending plus conflict) at once. */
export const MAX_OPEN_PROPOSALS = 20;

/** The largest text a file proposal holds, in bytes: the proposed text, and the file's text it is read against. */
export const MAX_PROPOSAL_BYTES = 512 * 1024;

/** The most edits one call applies, and one version stores to apply again (past it the version stores none). */
export const MAX_EDITS = 100;

/** The longest old text of one edit, in bytes of UTF-8: each edit searches the whole text for it. */
export const MAX_EDIT_OLD_BYTES = 64 * 1024;

/**
 * The versions, the user's drafts counted, at which the agent's revise of a proposal is refused. The user's draft and
 * approve's re-applied version never are, and may take a proposal past it.
 */
export const MAX_PROPOSAL_VERSIONS = 50;

/** The longest reason, in bytes of UTF-8: an agent's for a proposal or a version, and the user's for a reject. */
export const MAX_REASON_BYTES = 4 * 1024;

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const REASON_ERROR = `reason must be at most ${String(MAX_REASON_BYTES / 1024)} KiB of UTF-8 text; shorten it`;

/** A reason as a request takes it: at most MAX_REASON_BYTES. */
export const ProposalReason = z
  .string()
  .max(MAX_REASON_BYTES, { error: REASON_ERROR })
  .refine((reason) => utf8Bytes(reason) <= MAX_REASON_BYTES, { error: REASON_ERROR });

// Status moves.

/** `applying`: approved by the user and being written; nothing else may happen to it until that ends. */
export const ProposalStatus = z.enum(["pending", "applying", "approved", "rejected", "conflict"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const INITIAL_STATUS: ProposalStatus = "pending";

/**
 * What can happen to a proposal:
 * - `approve`: the user approves it; writing starts.
 * - `applied`: the write succeeded.
 * - `conflicted`: the target changed since the proposed version, or the change no longer fits; nothing was written.
 * - `apply_failed`: the write failed for another reason (the disk, a restart while writing); nothing was written and
 *   the user may approve it again.
 * - `reject`: the user rejects it.
 * - `resolve`: a new version replaces a conflicting one. A new version of a pending proposal keeps it pending, with
 *   no move: canRevise says whether a new version is allowed at all.
 */
export const PROPOSAL_EVENTS = ["approve", "applied", "conflicted", "apply_failed", "reject", "resolve"] as const;
export type ProposalEvent = (typeof PROPOSAL_EVENTS)[number];

const MOVES: Record<ProposalEvent, Partial<Record<ProposalStatus, ProposalStatus>>> = {
  approve: { pending: "applying" },
  applied: { applying: "approved" },
  conflicted: { applying: "conflict" },
  apply_failed: { applying: "pending" },
  reject: { pending: "rejected", conflict: "rejected" },
  resolve: { conflict: "pending" },
};

/** The status `event` moves a proposal in `status` to, or undefined when the event can't happen from there. */
export const nextStatus = (status: ProposalStatus, event: ProposalEvent): ProposalStatus | undefined => {
  if (!Object.hasOwn(MOVES, event)) return undefined;
  const moves = MOVES[event];
  return Object.hasOwn(moves, status) ? moves[status] : undefined;
};

/** Not decided yet: something can still happen to it. */
export const isOpen = (status: ProposalStatus): boolean => PROPOSAL_EVENTS.some((event) => nextStatus(status, event) !== undefined);

/**
 * Whether the user may approve it now (and so decide it either way). False for a conflict, which can only be
 * rejected or revised: ask canReject for the reject button.
 */
export const canDecide = (status: ProposalStatus): boolean => nextStatus(status, "approve") !== undefined;

export const canReject = (status: ProposalStatus): boolean => nextStatus(status, "reject") !== undefined;

/** Whether the agent may revise it, its new version replacing the current one: pending or conflict. */
export const canRevise = (status: ProposalStatus): boolean => canDecide(status) || nextStatus(status, "resolve") !== undefined;

/** Whether the user may save or drop a draft of it: only while it may be approved, so never on a conflict. */
export const canDraft = (status: ProposalStatus): boolean => canDecide(status);

/**
 * Whether it counts toward MAX_OPEN_PROPOSALS: pending or conflict. Unlike isOpen, a proposal being applied
 * doesn't count.
 */
export const countsTowardCap = (status: ProposalStatus): boolean => status === "pending" || status === "conflict";

// Read through the API (lenient: unknown fields are stripped).

const proposalFields = {
  id: z.string(),
  status: ProposalStatus,
  agentId: z.string(),
  reason: z.string(),
  /** The current version's number; approving names it, so the user approves what they saw. */
  version: z.int().positive(),
  /** The current version is the user's: a draft, or the version it was decided on. */
  editedByMe: z.boolean(),
  at: Timestamp,
  decidedAt: Timestamp.exactOptional(),
  rejectReason: z.string().exactOptional(),
  /** Why it couldn't be applied (a conflict, or a change no longer valid). */
  problem: Problem.exactOptional(),
};

export const FileProposalKind = z.enum(["edit", "create"]);
export type FileProposalKind = z.infer<typeof FileProposalKind>;

/** A change to a plain file. */
export const FileProposal = z.object({
  ...proposalFields,
  target: z.literal("file"),
  /** The file's real path, symlinks resolved, absolute. */
  path: z.string(),
  outsideWorkspace: z.boolean(),
  kind: FileProposalKind,
});
export type FileProposal = z.infer<typeof FileProposal>;

export const ItemProposalKind = z.enum(["create", "update", "delete"]);
export type ItemProposalKind = z.infer<typeof ItemProposalKind>;

/** A change to an item of a `propose` binder. */
export const ItemProposal = z.object({
  ...proposalFields,
  target: z.literal("item"),
  /** The target binder's id. */
  binder: z.string(),
  kind: ItemProposalKind,
  /** The target item; null for a create until it's approved. An approved delete keeps the handle it had. */
  handle: z.string().nullable(),
  /**
   * The new file's path, relative to the binder's folder, as the agent gave it; null except for a create in a
   * free-named binder. Kept apart from the fields so it can't collide with a property named `file`.
   */
  file: z.string().nullable(),
});
export type ItemProposal = z.infer<typeof ItemProposal>;

export const Proposal = z.discriminatedUnion("target", [FileProposal, ItemProposal]);
export type Proposal = z.infer<typeof Proposal>;

/** A proposal as `GET /proposals` lists it: without the current or proposed content. */
export const ProposalSummary = Proposal;
export type ProposalSummary = Proposal;

export const ProposalVersion = z.object({
  n: z.int().positive(),
  by: z.enum(["agent", "me"]),
  at: Timestamp,
  reason: z.string(),
});
export type ProposalVersion = z.infer<typeof ProposalVersion>;

/** A proposal's current version: the one with the highest `n`; undefined when there is none. */
export const currentVersion = <T extends { n: number }>(versions: readonly T[]): T | undefined =>
  versions.reduce<T | undefined>((highest, version) => (highest === undefined || version.n > highest.n ? version : highest), undefined);

/**
 * My draft while it is the current version: `mine`, and `theirs`, the agent's version it edits (the latest agent
 * version before it); undefined when the current version is the agent's. `versions` in the order of their numbers.
 */
export const myDraft = <T extends Pick<ProposalVersion, "n" | "by">>(versions: readonly T[]): { mine: T; theirs: T } | undefined => {
  const mine = currentVersion(versions);
  if (mine?.by !== "me") return undefined;
  const theirs = versions.findLast((version) => version.by === "agent" && version.n < mine.n);
  return theirs === undefined ? undefined : { mine, theirs };
};

/**
 * The agent's version my draft goes on (`DraftRequest.onVersion`): the one my current draft edits, else the current
 * version. Not the proposal's `version` while my draft is current: that is my draft's number.
 */
export const draftBase = <T extends Pick<ProposalVersion, "n" | "by">>(versions: readonly T[]): number | undefined =>
  myDraft(versions)?.theirs.n ?? currentVersion(versions)?.n;

/** A version's content as a draft compares it: a file's whole text, or an item's fields. */
type DraftComparable = { text: string } | { fields: Record<string, unknown> };

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
};

/**
 * Whether my draft's content is the agent's version it goes on, which would make "my version" no change at all: the
 * same text, or the same fields whatever their keys' order.
 */
export const sameAsAgents = (draft: DraftComparable, theirs: DraftComparable): boolean =>
  "text" in draft ? "text" in theirs && draft.text === theirs.text : "fields" in theirs && sameValue(draft.fields, theirs.fields);

/**
 * `GET /proposals/:id`: the proposal, its target as it is now (`current`: null when it doesn't exist, or a file that
 * can't be read as text), the version's content and every version.
 */
export const ProposalDetail = z.discriminatedUnion("target", [
  FileProposal.extend({
    current: z.string().nullable(),
    text: z.string(),
    versions: z.array(ProposalVersion),
    /**
     * An edit that is pending or in conflict only: the file is no longer the version the proposal was made on (a hand
     * edit since); absent otherwise.
     */
    baseChanged: z.boolean().exactOptional(),
  }),
  /** `fields`: field name → proposed value: `title`, `body` or property names, link values as ids. */
  ItemProposal.extend({ current: Item.nullable(), fields: z.record(z.string(), z.unknown()), versions: z.array(ProposalVersion) }),
]);
export type ProposalDetail = z.infer<typeof ProposalDetail>;

const kindsOf = new Map<unknown, ReadonlySet<unknown>>(Proposal.options.map((option) => [option.shape.target.value, new Set<unknown>(option.shape.kind.options)]));
const knownStatuses = new Set<unknown>(ProposalStatus.options);

/**
 * A newer service's entry: its target, status or kind (for a known target) is a string this app doesn't know.
 * Anything else malformed fails the parse.
 */
const fromNewerService = (value: unknown) => {
  if (typeof value !== "object" || value === null) return false;
  const { target, status, kind } = value as { target?: unknown; status?: unknown; kind?: unknown };
  const kinds = kindsOf.get(target);
  if (typeof target === "string" && kinds === undefined) return true;
  if (typeof status === "string" && !knownStatuses.has(status)) return true;
  return typeof kind === "string" && kinds !== undefined && !kinds.has(kind);
};

/** `GET /proposals`: the proposals matching ListProposalsQuery, oldest first; entries with a target, status or kind this app doesn't know are dropped. */
export const ListProposalsResponse = z.object({
  proposals: z.preprocess((value) => (Array.isArray(value) ? value.filter((entry) => !fromNewerService(entry)) : value), z.array(ProposalSummary)),
});
export type ListProposalsResponse = z.infer<typeof ListProposalsResponse>;

// Requests (strict).

/** `GET /proposals?status=`: every proposal, or those with one status. */
export const ListProposalsQuery = z.strictObject(
  {
    status: z
      .enum(ProposalStatus.options, { error: `status must be one of ${ProposalStatus.options.slice(0, -1).join(", ")} or ${ProposalStatus.options.at(-1) ?? ""}` })
      .exactOptional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? "unknown query parameter; send only status" : undefined,
  },
);
export type ListProposalsQuery = z.infer<typeof ListProposalsQuery>;

const versionError = (key: string) => `${key} must be a whole number of 1 or more: one of the proposal's versions`;

const versionNumber = (key: string) => {
  const error = versionError(key);
  return z.int({ error }).positive({ error });
};

/** `GET /proposals/:id?version=`: one version's content instead of the current version's. */
export const ProposalDetailQuery = z.strictObject(
  { version: queryInt(versionError("version"), 1).exactOptional() },
  { error: (issue) => (issue.code === "unrecognized_keys" ? "unknown query parameter; send only version" : undefined) },
);
export type ProposalDetailQuery = z.infer<typeof ProposalDetailQuery>;

/** `POST /proposals/:id/approve`: the version approved; another current version answers `proposal_changed`. */
export const ApproveRequest = z.strictObject({ version: versionNumber("version") });
export type ApproveRequest = z.infer<typeof ApproveRequest>;

/** `POST /proposals/:id/reject`: the user's reason, if they give one. */
export const RejectRequest = z.strictObject({ reason: ProposalReason.exactOptional() });
export type RejectRequest = z.infer<typeof RejectRequest>;

/**
 * `PUT /proposals/:id/draft`: the user's edit of the agent's version `onVersion` (`draftBase` of the versions; any
 * other number answers `proposal_changed`): a file's whole text, or an item's fields.
 */
export const DraftRequest = z.union(
  [
    z.strictObject({ onVersion: versionNumber("onVersion"), text: z.string() }),
    z.strictObject({ onVersion: versionNumber("onVersion"), fields: z.record(z.string(), z.unknown()) }),
  ],
  { error: "send onVersion and either text (for a file) or fields (for an item), not both" },
);
export type DraftRequest = z.infer<typeof DraftRequest>;

/**
 * The proposal routes' error codes: `proposal_not_found` for an unknown proposal id, a `?version=` it doesn't have,
 * or a message's `proposalId` that isn't that agent's open proposal; `proposal_not_pending` for one that can't be
 * decided now (being applied, already decided); `proposal_changed` for a request naming a version that is no longer
 * the current one. The app refetches the proposal.
 */
export const ProposalErrorCode = z.enum(["proposal_not_found", "proposal_not_pending", "proposal_changed"]);
export type ProposalErrorCode = z.infer<typeof ProposalErrorCode>;
