// The proposal contract the service and the app both read: which status moves exist (so a decided proposal is never
// decided again and a conflict never approved), which version is mine while it is the current one, which version my
// draft goes on and when it is no change at all, and a proposals list that skips what this app doesn't know (a target,
// a status, a kind) instead of failing whole.
import { expect, test } from "vitest";

import {
  canDecide,
  canDraft,
  canReject,
  canRevise,
  countsTowardCap,
  draftBase,
  isOpen,
  ListProposalsResponse,
  myDraft,
  nextStatus,
  PROPOSAL_EVENTS,
  ProposalStatus,
  ProposalSummary,
  sameAsAgents,
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
  expect(statusesWhere(canDraft), "takes my own version").toEqual(["pending"]);
  expect(statusesWhere(countsTowardCap), "counts toward the cap").toEqual(["conflict", "pending"]);
  expect(statusesWhere(isOpen), "not decided yet").toEqual(["applying", "conflict", "pending"]);
});

// The app offers "drop my edit" and marks the row by this; the service saves, drops and approves by it.
test("my draft is mine only while it is the current version, and it edits the agent's latest version before it", () => {
  const agent = (n: number) => ({ n, by: "agent" as const });
  const me = (n: number) => ({ n, by: "me" as const });

  expect(myDraft([]), "no version").toBeUndefined();
  expect(myDraft([agent(1)]), "the agent's version alone").toBeUndefined();
  expect(myDraft([agent(1), agent(2)]), "the agent's versions alone").toBeUndefined();
  expect(myDraft([agent(1), me(2)]), "my draft is current").toEqual({ mine: me(2), theirs: agent(1) });
  expect(myDraft([agent(1), agent(3), me(5)]), "my draft on the agent's revision").toEqual({ mine: me(5), theirs: agent(3) });
  expect(myDraft([agent(1), me(2), agent(3)]), "my draft superseded by a revise").toBeUndefined();
  expect(myDraft([agent(1), me(2), agent(3), me(4)]), "a new draft after the revise").toEqual({ mine: me(4), theirs: agent(3) });
});

// The app sends this number with a draft and the service takes no other: my draft's own number would be refused.
test("my draft goes on the agent's version: the current one, the one under my draft while that is current, the new one after a revise", () => {
  const agent = (n: number) => ({ n, by: "agent" as const });
  const me = (n: number) => ({ n, by: "me" as const });

  expect(draftBase([]), "no version").toBeUndefined();
  expect(draftBase([agent(1)]), "no draft yet").toBe(1);
  expect(draftBase([agent(1), agent(2)]), "no draft, after a revise").toBe(2);
  expect(draftBase([agent(1), me(2)]), "my draft is current").toBe(1);
  expect(draftBase([agent(1), agent(3), me(5)]), "my draft on the agent's revision").toBe(3);
  expect(draftBase([agent(1), me(2), agent(3)]), "a revise superseded my draft").toBe(3);
});

// The service refuses a draft that is the agent's version, so the app asks this before it sends one.
test("my draft is the same as the agent's version for the same text, or the same fields whatever the order of their keys", () => {
  const theirs = { fields: { title: "Login times out", labels: ["auth", "session"], links: { parent: "BL-1", blocks: null } } };

  expect(sameAsAgents({ text: "Run `pnpm install`.\n" }, { text: "Run `pnpm install`.\n" }), "the same text").toBe(true);
  expect(sameAsAgents({ text: "Run `pnpm install`.\n" }, { text: "Run `pnpm install`.\r\n" }), "another line end").toBe(false);
  expect(sameAsAgents({ fields: { links: { blocks: null, parent: "BL-1" }, labels: ["auth", "session"], title: "Login times out" } }, theirs), "keys in another order, nested too").toBe(true);
  expect(sameAsAgents({ fields: { ...theirs.fields, labels: ["session", "auth"] } }, theirs), "a list in another order").toBe(false);
  expect(sameAsAgents({ fields: { ...theirs.fields, title: "Login times out after 30 seconds" } }, theirs), "another value").toBe(false);
  expect(sameAsAgents({ fields: { ...theirs.fields, note: null } }, theirs), "a key the agent's version doesn't have").toBe(false);
  expect(sameAsAgents({ text: "Login times out" }, theirs), "a text against fields").toBe(false);
});

const common = { status: "pending", agentId: "agt_7f3c2a", workspace: "ws-site000001", version: 1, editedByMe: false, at: "2026-11-09T10:02:11.120Z" };
const fileRow = {
  ...common,
  id: "prp_1",
  target: "file",
  reason: "The install steps name the old package manager",
  path: "/home/sam/work/site-web/docs/install.md",
  outsideWorkspace: false,
  kind: "edit",
};
const itemRow = { ...common, id: "prp_2", target: "item", reason: "Seen on the site", binder: "bugs", kind: "update", handle: "BUG-1", file: null };
/** What a newer service might list: a target this app has no shape for, and a status and a kind it has no name for. */
const branchRow = { ...common, id: "prp_3", target: "branch", reason: "Merge it", branch: "footer-link" };
const pausedRow = { ...fileRow, id: "prp_4", status: "paused" };
const renameRow = { ...fileRow, id: "prp_5", kind: "rename" };
const archiveRow = { ...itemRow, id: "prp_6", kind: "archive" };

test("a list drops entries with a target, status or kind this app doesn't know and keeps the rest in order; a malformed entry fails it", () => {
  expect(ListProposalsResponse.parse({ proposals: [itemRow, branchRow, pausedRow, renameRow, fileRow, archiveRow] })).toEqual({ proposals: [itemRow, fileRow] });

  const without = (key: string) => Object.fromEntries(Object.entries(fileRow).filter(([name]) => name !== key));
  const malformed = {
    "no target": without("target"),
    "a file proposal without its path": without("path"),
    "a target that isn't a string": { ...fileRow, target: 7 },
    "a status that isn't a string": { ...fileRow, status: 7 },
    "no kind": without("kind"),
  };
  for (const [what, entry] of Object.entries(malformed)) {
    expect(ListProposalsResponse.safeParse({ proposals: [itemRow, entry] }).success, what).toBe(false);
  }
});

test("a listed proposal carries no content, and fields a newer service adds are stripped", () => {
  const versions = [{ n: 1, by: "agent", at: common.at, reason: fileRow.reason }];
  expect(ProposalSummary.parse({ ...fileRow, current: "Run `npm install`.\n", text: "Run `pnpm install`.\n", versions, colour: "red" })).toEqual(fileRow);
  expect(ProposalSummary.parse({ ...itemRow, current: null, fields: { note: "Seen again" }, versions, colour: "red" })).toEqual(itemRow);
});
