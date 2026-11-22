// What a proposal shows by its status, in the Needs me row and the tab alike: Approve only while it can be approved
// (shown, disabled, while it's being written), Reject while it's open, a conflict marked as one, and the decision once
// there is one. Every status the shared contract has must be listed here, so a new one is a decision, not a default.
import { expect, test } from "vitest";

import { ProposalStatus } from "@wombat/shared/proposals";

import { proposalShows } from "./proposal-actions.ts";

type Expected = { approve: boolean; reject: boolean; conflict: boolean; outcome: "allowed" | "refused" | undefined };

// By what each status means to the user: waiting for a decision, being written, conflicting with the file, decided.
const EXPECTED: Record<ProposalStatus, Expected> = {
  pending: { approve: true, reject: true, conflict: false, outcome: undefined },
  applying: { approve: true, reject: true, conflict: false, outcome: undefined },
  conflict: { approve: false, reject: true, conflict: true, outcome: undefined },
  approved: { approve: false, reject: false, conflict: false, outcome: "allowed" },
  rejected: { approve: false, reject: false, conflict: false, outcome: "refused" },
};

test("every status shows Approve, Reject, the conflict mark and the outcome by what it means", () => {
  expect(Object.keys(EXPECTED).sort(), "every status has an expectation").toEqual([...ProposalStatus.options].sort());
  for (const status of ProposalStatus.options) {
    const shows = proposalShows(status);
    const outcome = shows.outcome === undefined ? undefined : shows.outcome.allowed ? "allowed" : "refused";
    expect({ approve: shows.approve, reject: shows.reject, conflict: shows.mark === "Conflict", outcome }, status).toEqual(EXPECTED[status]);
  }
});
