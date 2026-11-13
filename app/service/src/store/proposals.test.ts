// The store's proposals: each write is one transaction that takes the next seq, a proposal is decided only
// while pending, and what's stored reads back the same after a reopen, a proposed create's file included.
import { describe, expect, test } from "vitest";

import { open, tempStorePath } from "../../test/store-fixtures.ts";

const NEW = {
  structure: "bugs",
  itemId: "0196f3c2-1a00-7000-8000-000000000002",
  kind: "update" as const,
  fields: { note: "Seen again" },
  reason: "Reported twice",
  baseVersion: "abc123",
  agentId: "agent-1",
  file: null as string | null,
};

describe("store proposals", () => {
  test("storing and deciding each take the next seq; a decided proposal isn't decided again and takes none", () => {
    const store = open({ path: tempStorePath() });
    const start = store.currentSeq();

    const stored = store.insertProposal(NEW);
    const decided = store.setProposalStatus(stored.proposal.id, "conflict", { message: "The file changed." });

    expect([stored.seq, decided?.seq]).toEqual([start + 1, start + 2]);
    expect(store.setProposalStatus(stored.proposal.id, "approved")).toBeUndefined();
    expect(store.setProposalStatus("missing", "rejected")).toBeUndefined();
    expect(store.currentSeq()).toBe(start + 2);
  });
});
