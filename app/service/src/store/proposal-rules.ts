// The store's status decisions, all derived from the shared contract so no status is named here.
import { canDecide, countsTowardCap, isOpen, nextStatus, ProposalStatus, type ProposalEvent, type ProposalVersion } from "@wombat/shared/proposals";

const statusesWhere = (test: (status: ProposalStatus) => boolean) => ProposalStatus.options.filter(test);

export const COUNTED_OPEN: readonly ProposalStatus[] = statusesWhere(countsTowardCap);

/** Being written: a write that ends must settle it. */
export const APPLYING: readonly ProposalStatus[] = statusesWhere((status) => nextStatus(status, "applied") !== undefined);

/**
 * The outcomes the agent is told about once, and that carry `decidedAt`: decided for good (approved, rejected) or
 * a conflict waiting on the agent's new version.
 */
export const OUTCOMES: readonly ProposalStatus[] = statusesWhere((status) => !isOpen(status) || nextStatus(status, "resolve") !== undefined);

export const isOutcome = (status: ProposalStatus) => OUTCOMES.includes(status);

/** A conflict: waiting on a new version, which is based on the target as it is now. */
export const awaitsNewVersion = (status: ProposalStatus) => nextStatus(status, "resolve") !== undefined;

/** Whether my draft may go on it or be dropped: only while it may be approved, so never on a conflict. */
export const takesDraft = (status: ProposalStatus) => canDecide(status);

const SETTLE_EVENTS = ["applied", "conflicted", "apply_failed"] as const satisfies readonly ProposalEvent[];

/** The event that settles a write from `status` into `outcome`, or undefined when no settling event does. */
export const settleEvent = (status: ProposalStatus, outcome: ProposalStatus) =>
  SETTLE_EVENTS.find((event) => nextStatus(status, event) === outcome);

export type VersionAuthor = ProposalVersion["by"];

/** A proposal's current version: the one with the highest stored `n`; undefined when none is stored. */
export const currentVersion = <T extends { n: number }>(versions: readonly T[]): T | undefined =>
  versions.reduce<T | undefined>((highest, version) => (highest === undefined || version.n > highest.n ? version : highest), undefined);

/**
 * Whether my draft may go on agent version `onVersion` (the latest agent version), and which earlier draft of mine
 * on it the new one replaces.
 */
export const draftSlot = (versions: readonly { n: number; by: VersionAuthor }[], onVersion: number): { replaces?: number } | undefined => {
  const latestAgent = versions.findLast((version) => version.by === "agent");
  if (latestAgent?.n !== onVersion) return undefined;
  const current = currentVersion(versions);
  return current !== undefined && current.by === "me" && current.n > onVersion ? { replaces: current.n } : {};
};
