// The store's proposals: each write is one transaction that takes the next seq, a proposal is decided only
// while pending, and what's stored reads back the same after a reopen, a proposed create's file included.
import { describe, expect, test } from "vitest";

import { open, tempStorePath } from "../../test/store-fixtures.ts";

const NEW = {
  target: "item" as const,
  path: null,
  structure: "bugs",
  itemId: "0196f3c2-1a00-7000-8000-000000000002",
  kind: "update" as const,
  reason: "Reported twice",
  baseVersion: "abc123",
  agentId: "agent-1",
  file: null as string | null,
};
const FIELDS = { fields: { note: "Seen again" } };

describe("store proposals", () => {
  test("storing and deciding each take the next seq; a decided proposal isn't decided again and takes none", () => {
    const store = open({ path: tempStorePath() });
    const start = store.currentSeq();

    const stored = store.insertProposal(NEW, FIELDS);
    const applying = store.beginApplying(stored.proposal.id, 1, { version: 1 });
    const decided = store.settle(stored.proposal.id, { status: "conflict", problem: { message: "The file changed." } });

    expect([stored.seq, applying?.seq, decided?.seq]).toEqual([start + 1, start + 2, start + 3]);
    expect(store.beginApplying(stored.proposal.id, 1, { version: 1 })).toBeUndefined();
    expect(store.settle(stored.proposal.id, { status: "approved" })).toBeUndefined();
    expect(store.rejectProposal("missing")).toBeUndefined();
    expect(store.currentSeq()).toBe(start + 3);
  });
});
