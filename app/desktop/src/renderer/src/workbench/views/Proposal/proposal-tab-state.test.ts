// What the tab says when the file changed since the proposal was made: it promises that Approve applies the agent's
// edits again only when the current version is the agent's; my version holds no edits to apply again.
import { expect, test } from "vitest";

import type { ProposalDetail } from "@wombat/shared/proposals";

import { proposalTabState } from "./proposal-tab-state.ts";

const OPEN_EDIT: ProposalDetail = {
  id: "p-1",
  status: "pending",
  agentId: "a-1",
  reason: "The bakery's hours changed.",
  version: 1,
  editedByMe: false,
  at: "2026-03-02T09:00:00Z",
  target: "file",
  path: "/work/shop/hours.md",
  outsideWorkspace: false,
  kind: "edit",
  current: "Monday: 7:00 to 18:00\nSunday: hand edit\n",
  text: "Monday: 7:00 to 17:00\nSunday: closed\n",
  versions: [{ n: 1, by: "agent", at: "2026-03-02T09:00:00Z", reason: "The bakery's hours changed." }],
  baseChanged: true,
};

test.each<[string, Partial<ProposalDetail>, "agent" | "mine" | undefined]>([
  ["the file changed and the agent's version is current", {}, "agent"],
  ["the file changed and my version is current", { editedByMe: true, version: 2, versions: [...OPEN_EDIT.versions, { n: 2, by: "me", at: "2026-03-02T09:05:00Z", reason: "" }] }, "mine"],
  ["the file didn't change", { baseChanged: false }, undefined],
  ["a conflict", { status: "conflict" }, undefined],
  ["the file can't be read", { current: null }, undefined],
])("%s", (_name, change, want) => {
  expect(proposalTabState({ ...OPEN_EDIT, ...change } as ProposalDetail).changedSince).toBe(want);
});
