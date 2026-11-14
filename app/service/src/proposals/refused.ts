import { ItemsErrorCode } from "@wombat/shared/api";
import { canDecide, canReject, ProposalErrorCode } from "@wombat/shared/proposals";

import type { Store, StoredProposal } from "../store/store.ts";

/** A propose call refused for a reason the agent can act on, which the message states; nothing was stored. */
export class ProposalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRefused";
  }
}

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
    `Proposal ${stored.id} is ${stored.status}; ${allowed}. Refresh the proposals to see its state.`,
  );

export const notApprovable = (stored: StoredProposal) => notPending(stored, "only a pending proposal can be approved");

export const notRejectable = (stored: StoredProposal) => notPending(stored, "only a pending proposal or a conflict can be rejected");

type Reads = Pick<Store, "getProposal" | "listVersionHeads">;

/** The proposal `id` if it may be approved at `version`, its current version; ProposalError otherwise. */
export const toApprove = (store: Reads, id: string, version: number): StoredProposal => {
  const stored = store.getProposal(id);
  if (stored === undefined) throw notFound(id);
  if (!canDecide(stored.status)) throw notApprovable(stored);
  const current = store.listVersionHeads(id).at(-1)?.n;
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
