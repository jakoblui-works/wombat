import { ItemsErrorCode } from "@wombat/shared/api";
import { canDecide, canDraft, canReject, canRevise, nextStatus, ProposalErrorCode } from "@wombat/shared/proposals";

import { currentVersion } from "../store/proposal-rules.ts";
import type { Store, StoredProposal } from "../store/store.ts";

/** A propose call refused for a reason the agent can act on, which the message states; nothing was stored. */
export class ProposalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRefused";
  }
}

/** A draft the user's request can't make (the wrong shape for the target, text or fields that don't pass); nothing changed. */
export class DraftRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftRefused";
  }
}

/** Ends every refusal of a revise: the proposal stays as it was. */
export const PROPOSAL_UNCHANGED = "Your proposal is unchanged.";

/** What a revise refusal asks of the agent when its proposal can no longer be approved at all. */
export const ASK_TO_REJECT = "ask the user to reject this proposal";

type DecisionErrorCode = ProposalErrorCode | typeof ItemsErrorCode.enum.items_not_configured;

/** Why reading or deciding a proposal was refused; nothing changed. */
export class ProposalError extends Error {
  readonly code: DecisionErrorCode;

  constructor(code: DecisionErrorCode, message: string) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
  }
}

export const ITEMS_NOT_CONFIGURED = "The items aren't set up. Set WOMBAT_ITEMS to the absolute path of the items folder and restart the service.";

/** An item proposal read or decided while the service has no items root. */
export const itemsNotConfigured = () => new ProposalError(ItemsErrorCode.enum.items_not_configured, ITEMS_NOT_CONFIGURED);

export const notFound = (id: string) =>
  new ProposalError(ProposalErrorCode.enum.proposal_not_found, `No proposal has the id ${id}. Refresh the proposals to see the current ones.`);

/** An approve or reject that found the proposal in a status it doesn't allow; `allowed` ends the sentence. */
const notPending = (stored: StoredProposal, allowed: string) =>
  new ProposalError(
    ProposalErrorCode.enum.proposal_not_pending,
    nextStatus(stored.status, "applied") === undefined
      ? `Proposal ${stored.id} is ${stored.status}; ${allowed}. Refresh the proposals to see its state.`
      : `Proposal ${stored.id} is being applied: the service is writing it now, or couldn't tell at its start whether its write landed. ` +
          "Refresh the proposals in a moment; if it stays this way, make the items root or the file's folder readable for the service and restart the service.",
  );

export const notApprovable = (stored: StoredProposal) => notPending(stored, "only a pending proposal can be approved");

export const notRejectable = (stored: StoredProposal) => notPending(stored, "only a pending proposal or a conflict can be rejected");

export const notEditable = (stored: StoredProposal) => notPending(stored, "only a pending proposal can be edited");

type Reads = Pick<Store, "getProposal" | "listVersionHeads">;

/** The proposal `id` if it may be approved at `version`, its current version; ProposalError otherwise. */
export const toApprove = (store: Reads, id: string, version: number): StoredProposal => {
  const stored = store.getProposal(id);
  if (stored === undefined) throw notFound(id);
  if (!canDecide(stored.status)) throw notApprovable(stored);
  const current = currentVersion(store.listVersionHeads(id))?.n;
  if (current !== version) {
    throw new ProposalError(
      ProposalErrorCode.enum.proposal_changed,
      `Version ${String(version)} isn't proposal ${id}'s current version${current === undefined ? "" : `; version ${String(current)} is`}. Refresh the proposal, review its current version and approve that one.`,
    );
  }
  return stored;
};

/** The proposal `id` if it may be rejected; ProposalError otherwise. */
export const toReject = (store: Reads, id: string): StoredProposal => {
  const stored = store.getProposal(id);
  if (stored === undefined) throw notFound(id);
  if (!canReject(stored.status)) throw notRejectable(stored);
  return stored;
};

/** The proposal `id` if a draft may go on it or be dropped: pending; ProposalError otherwise. */
export const toDraft = (store: Reads, id: string): StoredProposal => {
  const stored = store.getProposal(id);
  if (stored === undefined) throw notFound(id);
  if (!canDraft(stored.status)) throw notEditable(stored);
  return stored;
};

/**
 * The proposal `id` if it is `agentId`'s and still open to a new version (pending or a conflict), else undefined:
 * an unknown id, another agent's proposal and a decided one alike, so each caller's refusal reads the same for all.
 */
export const ownOpenProposal = (store: Pick<Store, "getProposal">, agentId: string, id: string): StoredProposal | undefined => {
  const stored = store.getProposal(id);
  return stored?.agentId === agentId && canRevise(stored.status) ? stored : undefined;
};

/** The revise refusal for a proposal that isn't the agent's open one, worded as for an unknown id. */
export const notOwnOpenProposal = (id: string) =>
  new ProposalRefused(
    `You have no open proposal with the id ${id}. Check the id your propose call answered; a proposal the user already ` +
      "approved or rejected can't change anymore, so propose anew instead.",
  );
