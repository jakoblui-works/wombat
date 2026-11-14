// Proposals: changes an agent proposed to a plain file or an item, kept by the service until the user approves or
// rejects them in the app. Request bodies are strict, responses lenient, as in `api.ts`. This module owns the status
// moves and the predicates on a status: the service and the app ask nextStatus and the predicates below, never
// compare statuses themselves.
import { z } from "zod";

import { Item, Problem } from "./items.ts";
import { queryInt } from "./routes.ts";

/** An ISO date-time with its offset, as every timestamp on the wire. */
export const Timestamp = z.iso.datetime({ offset: true });

/** The most proposals one agent may have counting toward the cap (countsTowardCap: pending plus conflict) at once. */
export const MAX_OPEN_PROPOSALS = 20;

/** The largest text a file proposal holds, in bytes: the proposed text, and the file's text it is read against. */
export const MAX_PROPOSAL_BYTES = 512 * 1024;

// Status moves.

/** `applying`: approved by the user and being written; nothing else may happen to it until that ends. */
export const ProposalStatus = z.enum(["pending", "applying", "approved", "rejected", "conflict"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/** The status a new proposal is stored with. */
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

/** Whether the user may reject it now: a pending proposal or a conflict. */
export const canReject = (status: ProposalStatus): boolean => nextStatus(status, "reject") !== undefined;

/** Whether a new version (the agent's revision, the user's draft) may replace the current one: pending or conflict. */
export const canRevise = (status: ProposalStatus): boolean => canDecide(status) || nextStatus(status, "resolve") !== undefined;

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
  /** The user edited it: some version is theirs. */
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

/** A change to an item of a `propose` structure. */
export const ItemProposal = z.object({
  ...proposalFields,
  target: z.literal("item"),
  /** The target structure's id. */
  structure: z.string(),
  kind: ItemProposalKind,
  /** The target item; null for a create until it's approved. An approved delete keeps the handle it had. */
  handle: z.string().nullable(),
  /**
   * The new file's path, relative to the structure's folder, as the agent gave it; null except for a create in a
   * free-named structure. Kept apart from the fields so it can't collide with a property named `file`.
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

/** `GET /proposals/:id`: the proposal, its target as it is now (null when it doesn't exist), the current version's content and every version. */
export const ProposalDetail = z.discriminatedUnion("target", [
  FileProposal.extend({ current: z.string().nullable(), text: z.string(), versions: z.array(ProposalVersion) }),
  /** `fields`: field name → proposed value: `title`, `body` or property names, link values as ids. */
  ItemProposal.extend({ current: Item.nullable(), fields: z.record(z.string(), z.unknown()), versions: z.array(ProposalVersion) }),
]);
export type ProposalDetail = z.infer<typeof ProposalDetail>;

const knownTargets = new Set<unknown>(Proposal.options.map((option) => option.shape.target.value));

/** A newer service's target: a string this app doesn't know. Anything else malformed fails the parse. */
const unknownTarget = (value: unknown) => {
  if (typeof value !== "object" || value === null) return false;
  const { target } = value as { target?: unknown };
  return typeof target === "string" && !knownTargets.has(target);
};

/** `GET /proposals`: the proposals matching ListProposalsQuery, oldest first; targets this app doesn't know are dropped. */
export const ListProposalsResponse = z.object({
  proposals: z.preprocess((value) => (Array.isArray(value) ? value.filter((entry) => !unknownTarget(entry)) : value), z.array(ProposalSummary)),
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
export const RejectRequest = z.strictObject({ reason: z.string().exactOptional() });
export type RejectRequest = z.infer<typeof RejectRequest>;

/**
 * `PUT /proposals/:id/draft`: the user's edit of version `onVersion` (another current version answers
 * `proposal_changed`): a file's whole text, or an item's fields.
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
 * The proposal routes' error codes: `proposal_not_found` for an unknown proposal id, `proposal_not_pending` for one
 * that can't be decided now (being applied, already decided), `proposal_changed` for a request naming a version that
 * is no longer the current one. The app refetches the proposal.
 */
export const ProposalErrorCode = z.enum(["proposal_not_found", "proposal_not_pending", "proposal_changed"]);
export type ProposalErrorCode = z.infer<typeof ProposalErrorCode>;
