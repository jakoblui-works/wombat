import { ProposalErrorCode } from "@wombat/shared/proposals";

import { ServiceError } from "../../../../data/client.ts";

/** What a refused send says. A refused reference gets what to do about it: the proposal is gone from the agent's open ones. */
export const sendFailure = (error: Error, withReference: boolean): string =>
  withReference && error instanceof ServiceError && error.code === ProposalErrorCode.enum.proposal_not_found
    ? "the proposal is decided or gone, so the agent can't be asked about it. Remove the reference and send again."
    : error.message;
