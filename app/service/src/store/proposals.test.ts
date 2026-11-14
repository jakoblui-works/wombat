// The store's proposals: each write is one transaction that takes the next seq, a proposal is decided only
// while pending, and what's stored reads back the same after a reopen, a proposed create's file included. The
// database's own checks take exactly the values the shared contract lists, and a version number is given once.
import { DatabaseSync } from "node:sqlite";

import { FileProposalKind, ItemProposalKind, ProposalStatus, ProposalVersion } from "@wombat/shared/proposals";
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
const NEW_FILE = {
  target: "file" as const,
  path: "/home/sam/work/site-web/docs/install.md",
  structure: null,
  itemId: null,
  kind: "edit" as const,
  reason: "The install steps name the old package manager",
  baseVersion: "4d5e6f",
  agentId: "agent-1",
  file: null,
};
const TEXT = { text: "Run `pnpm install`.\n", edits: [{ oldText: "npm", newText: "pnpm" }] };

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

  // A status or kind the contract gains must reach the schema too, or the first move into it fails at runtime.
  test("the database takes every status, kind and version author the shared contract lists, and refuses any other", () => {
    const path = tempStorePath();
    const store = open({ path });
    const file = store.insertProposal(NEW_FILE, TEXT).proposal.id;
    const item = store.insertProposal(NEW, FIELDS).proposal.id;
    store.close();
    const db = new DatabaseSync(path);
    const setProposal = (column: "status" | "kind", id: string) => {
      const statement = db.prepare(`UPDATE proposals SET ${column} = ? WHERE id = ?`);
      return (value: string) => statement.run(value, id).changes;
    };
    const author = db.prepare("UPDATE proposal_versions SET by = ? WHERE proposal_id = ?");
    // [what, the contract's values, a raw write of one, a value the contract doesn't have]
    const columns: [string, readonly string[], (value: string) => unknown, string][] = [
      ["a file proposal's status", ProposalStatus.options, setProposal("status", file), "archived"],
      ["an item proposal's status", ProposalStatus.options, setProposal("status", item), "archived"],
      ["a file proposal's kind", FileProposalKind.options, setProposal("kind", file), "rename"],
      ["an item proposal's kind", ItemProposalKind.options, setProposal("kind", item), "move"],
      ["a version's author", ProposalVersion.shape.by.options, (value) => author.run(value, item).changes, "reviewer"],
    ];
    try {
      for (const [what, values, write, invented] of columns) {
        for (const value of values) expect(write(value), `${what} ${value}`).toBe(1);
        expect(() => write(invented), `${what} ${invented}`).toThrow(/CHECK constraint/);
      }
    } finally {
      db.close();
    }
  });

  // Approving names the version the user saw: a number given again would apply text they never saw.
  test("a version number is never given twice, and only the current version can be applied", () => {
    const store = open({ path: tempStorePath() });
    const { id } = store.insertProposal(NEW_FILE, TEXT).proposal;
    const numbers = () => store.listVersions(id).map((version) => version.n);
    const given = new Set(numbers());
    /** Runs a store call and returns the one number it gave, which must be new and the highest so far. */
    const givenBy = (what: string, call: () => unknown) => {
      const highest = Math.max(...given);
      expect(call(), what).toBeDefined();
      const fresh = numbers().filter((n) => !given.has(n));
      expect(fresh, `${what} gives one new number`).toHaveLength(1);
      const [n = 0] = fresh;
      expect(n, `${what}'s number is above every earlier one`).toBeGreaterThan(highest);
      given.add(n);
      return n;
    };

    givenBy("my draft", () => store.putDraft(id, 1, { text: "Run `pnpm i`.\n" }));
    givenBy("my second draft, replacing the first", () => store.putDraft(id, 1, { text: "Run `pnpm install --frozen-lockfile`.\n" }));
    expect(store.clearDraft(id), "clearing my draft").toBeDefined();
    const current = givenBy("the agent's new version", () => store.addAgentVersion(id, { text: "Run `pnpm install` once.\n" }, "Shorter"));

    const before = { proposal: store.getProposal(id), versions: store.listVersions(id), seq: store.currentSeq() };
    for (const earlier of [...given].filter((n) => n !== current)) {
      expect(store.beginApplying(id, earlier, { version: "9f2c" }), `applying version ${String(earlier)}`).toBeUndefined();
    }
    expect({ proposal: store.getProposal(id), versions: store.listVersions(id), seq: store.currentSeq() }).toEqual(before);
    expect(store.beginApplying(id, current, { version: "9f2c" })).toMatchObject({ seq: before.seq + 1, proposal: { status: "applying" } });
  });
});
