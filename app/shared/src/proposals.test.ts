// The proposal contract the service and the app both read: which status moves exist (so a decided proposal is never
// decided again and a conflict never approved), and a proposals list that skips a target this app doesn't know
// instead of failing whole.
import { expect, test } from "vitest";

import {
  canDecide,
  canReject,
  canRevise,
  countsTowardCap,
  isOpen,
  ListProposalsResponse,
  nextStatus,
  PROPOSAL_EVENTS,
  ProposalStatus,
  ProposalSummary,
} from "./proposals.ts";

/** Every move the contract allows, as `status event → status`; any other pair is refused. */
const MOVES = [
  "pending approve → applying",
  "applying applied → approved",
  "applying conflicted → conflict",
  "applying apply_failed → pending",
  "pending reject → rejected",
  "conflict reject → rejected",
  "conflict resolve → pending",
];

const statusesWhere = (predicate: (status: ProposalStatus) => boolean) => ProposalStatus.options.filter(predicate).sort();

test("a status changes only by the contract's moves, and the predicates name the statuses they're for", () => {
  const moves: string[] = [];
  for (const status of ProposalStatus.options) {
    for (const event of PROPOSAL_EVENTS) {
      const next = nextStatus(status, event);
      if (next !== undefined) moves.push(`${status} ${event} → ${next}`);
    }
  }
  expect(moves.sort()).toEqual([...MOVES].sort());

  expect(statusesWhere(canDecide), "may be approved").toEqual(["pending"]);
  expect(statusesWhere(canReject), "may be rejected").toEqual(["conflict", "pending"]);
  expect(statusesWhere(canRevise), "may get a new version").toEqual(["conflict", "pending"]);
  expect(statusesWhere(countsTowardCap), "counts toward the cap").toEqual(["conflict", "pending"]);
  expect(statusesWhere(isOpen), "not decided yet").toEqual(["applying", "conflict", "pending"]);
});

const common = { status: "pending", agentId: "agt_7f3c2a", version: 1, editedByMe: false, at: "2026-11-09T10:02:11.120Z" };
const fileRow = {
  ...common,
  id: "prp_1",
  target: "file",
  reason: "The install steps name the old package manager",
  path: "/home/sam/work/site-web/docs/install.md",
  outsideWorkspace: false,
  kind: "edit",
};
const itemRow = { ...common, id: "prp_2", target: "item", reason: "Seen on the site", structure: "bugs", kind: "update", handle: "BUG-1", file: null };
/** What a newer service might list: a target this app has no shape for. */
const branchRow = { ...common, id: "prp_3", target: "branch", reason: "Merge it", branch: "footer-link" };

test("a list drops entries with a target this app doesn't know and keeps the rest in order; a malformed entry fails it", () => {
  expect(ListProposalsResponse.parse({ proposals: [itemRow, branchRow, fileRow] })).toEqual({ proposals: [itemRow, fileRow] });

  const without = (key: string) => Object.fromEntries(Object.entries(fileRow).filter(([name]) => name !== key));
  for (const [what, entry] of Object.entries({ "no target": without("target"), "a file proposal without its path": without("path"), "a target that isn't a string": { ...fileRow, target: 7 } })) {
    expect(ListProposalsResponse.safeParse({ proposals: [itemRow, entry] }).success, what).toBe(false);
  }
});

test("a listed proposal carries no content, and fields a newer service adds are stripped", () => {
  const versions = [{ n: 1, by: "agent", at: common.at, reason: fileRow.reason }];
  expect(ProposalSummary.parse({ ...fileRow, current: "Run `npm install`.\n", text: "Run `pnpm install`.\n", versions, colour: "red" })).toEqual(fileRow);
  expect(ProposalSummary.parse({ ...itemRow, current: null, fields: { note: "Seen again" }, versions, colour: "red" })).toEqual(itemRow);
});
