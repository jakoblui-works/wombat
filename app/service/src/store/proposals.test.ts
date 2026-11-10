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

  test("a proposal reads back as stored, filtered by status, after a reopen", () => {
    const path = tempStorePath();
    const first = open({ path });
    const kept = first.insertProposal(NEW).proposal;
    const createWithFile = { ...NEW, kind: "create" as const, itemId: null, baseVersion: null, file: "guides/setup.md" };
    const created = first.insertProposal(createWithFile).proposal;
    expect((created as { file?: unknown }).file, "the file as stored").toBe("guides/setup.md");
    first.setProposalStatus(created.id, "approved", undefined, "0196f3c2-1a00-7000-8000-000000000009");
    first.close();

    const store = open({ path });

    expect(store.getProposal(kept.id)).toEqual({ ...NEW, id: kept.id, status: "pending", at: kept.at });
    expect(store.listProposals("pending").map((proposal) => proposal.id)).toEqual([kept.id]);
    expect(store.getProposal(created.id)).toMatchObject({ status: "approved", itemId: "0196f3c2-1a00-7000-8000-000000000009", file: "guides/setup.md" });
    expect(store.listProposals().find((proposal) => proposal.id === created.id), "listed with its file").toMatchObject({ file: "guides/setup.md" });
    expect(store.listProposals()).toHaveLength(2);
  });
});
