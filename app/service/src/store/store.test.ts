// The store: agent summaries and an append-only log of entries, read back after a cursor.
import { DatabaseSync } from "node:sqlite";

import { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import type { NewLogEntry } from "./store.ts";
import {
  open,
  realisticTurn,
  summary,
  tempDir,
  tempStorePath,
  textChunk,
} from "../../test/store-fixtures.ts";

const textOf = (entry: LogEntry) =>
  entry.type === "session_update" && entry.update.sessionUpdate === "agent_message_chunk" && entry.update.content.type === "text"
    ? entry.update.content.text
    : undefined;

describe("append", () => {

  test("a batch that fails stores nothing: no entries, no seq taken", () => {
    const path = tempStorePath();
    const store = open({ path });
    store.putAgent(summary("a1"));
    store.append("a1", [textChunk("kept")]);
    const seqBefore = store.currentSeq();
    const logBefore = store.readLog("a1");

    // A failure after the batch's first entry is written, so only a rollback can undo that write and the seqs.
    const other = new DatabaseSync(path);
    other.exec(`CREATE TRIGGER fail_on_marker BEFORE INSERT ON log_entries WHEN NEW.body LIKE '%fail-this-insert%'
                BEGIN SELECT RAISE(ABORT, 'refused by the test'); END`);
    other.close();
    expect(() => store.append("a1", [textChunk("first"), textChunk("fail-this-insert"), textChunk("last")])).toThrow();
    // Failures before any write: an entry that can't be serialized, and an agent that isn't stored.
    const unserializable = { type: "user_message", text: 10n } as unknown as NewLogEntry;
    expect(() => store.append("a1", [textChunk("first"), unserializable])).toThrow();
    expect(() => store.append("ghost", [textChunk("to nobody")])).toThrow();

    expect(store.currentSeq()).toBe(seqBefore);
    expect(store.readLog("a1")).toEqual(logBefore);
    expect(store.readLog("ghost")).toEqual({ entries: [], truncated: false });
    expect(store.append("a1", [textChunk("next")])).toEqual([seqBefore + 1]);
  });
});

describe("persistence", () => {

  test("a new database file gets a new dbId and starts empty", () => {
    const dir = tempDir();
    const first = open({ path: tempStorePath(dir) });
    first.putAgent(summary("a1"));
    const second = open({ path: `${dir}/other/service.db` });

    expect(typeof second.dbId).toBe("string");
    expect(second.dbId).not.toBe("");
    expect(second.dbId).not.toBe(first.dbId);
    expect(second.currentSeq()).toBe(0);
    expect(second.listAgents()).toEqual([]);
  });
});

describe("readLog", () => {

  test("come back as valid shared log entries, unchanged, with at defaulting to now", () => {
    const now = new Date("2026-11-09T12:34:56.000Z");
    const store = open({ path: tempStorePath(), now: () => now });
    store.putAgent(summary("a1"));
    const withoutAt = textChunk("No timestamp given.");

    const seqs = store.append("a1", [...realisticTurn, withoutAt]);
    const { entries } = store.readLog("a1");

    expect(entries).toHaveLength(realisticTurn.length + 1);
    for (const entry of entries) expect(LogEntry.parse(entry)).toEqual(entry);
    expect(entries.slice(0, realisticTurn.length)).toEqual(
      realisticTurn.map((entry, index) => ({ ...entry, seq: seqs[index], agentId: "a1" })),
    );
    const last = entries.at(-1);
    expect(last).toMatchObject({ ...withoutAt, seq: seqs.at(-1), agentId: "a1" });
    expect(Date.parse(last?.at ?? "")).toBe(now.getTime());
  });
});

describe("the per-agent size cap", () => {
  /** A cap chosen by the test; the product's constant is never assumed. */
  const CAP = 4096;

  test("past the cap the oldest entries go, the newest stay, other agents are untouched, and truncated says so", () => {
    const store = open({ path: tempStorePath(), maxLogBytesPerAgent: CAP });
    store.putAgent(summary("big"));
    store.putAgent(summary("small"));
    const smallChunks = ["one", "two", "three", "four"].map((word) => textChunk(`${word} ${"s".repeat(CAP / 16)}`));
    const smallSeqs = [...store.append("small", smallChunks.slice(0, 2))];

    const bigSeqs = store.append(
      "big",
      Array.from({ length: 20 }, (_, index) => textChunk(`chunk ${index} ${"b".repeat(CAP / 4)}`)),
    );
    smallSeqs.push(...store.append("small", smallChunks.slice(2)));

    const kept = store.readLog("big").entries;
    const keptSeqs = kept.map((entry) => entry.seq);
    expect(keptSeqs.length).toBeGreaterThan(0);
    expect(keptSeqs.length).toBeLessThan(bigSeqs.length);
    // Oldest deleted first: what's kept is the newest run of the batch.
    expect(keptSeqs).toEqual(bigSeqs.slice(bigSeqs.length - keptSeqs.length));
    expect(kept.reduce((bytes, entry) => bytes + Buffer.byteLength(textOf(entry) ?? ""), 0)).toBeLessThanOrEqual(CAP);

    const oldestKept = keptSeqs[0] ?? 0;
    expect(store.readLog("big", 0).truncated).toBe(true);
    expect(store.readLog("big", oldestKept - 2).truncated).toBe(true);
    expect(store.readLog("big", oldestKept - 1)).toEqual({ entries: kept, truncated: false });

    expect(store.readLog("small")).toMatchObject({ truncated: false });
    expect(store.readLog("small").entries.map((entry) => entry.seq)).toEqual(smallSeqs);
  });

  test("the newest entry survives even when it alone is over the cap", () => {
    const store = open({ path: tempStorePath(), maxLogBytesPerAgent: CAP });
    store.putAgent(summary("a1"));
    store.append("a1", [textChunk("first"), textChunk("second")]);
    const [hugeSeq] = store.append("a1", [textChunk(`huge ${"h".repeat(CAP * 2)}`)]);

    const result = store.readLog("a1");
    expect(result.entries.map((entry) => entry.seq)).toEqual([hugeSeq]);
    expect(result.truncated).toBe(true);
  });
});

describe("deleteAgent", () => {
  test("removes the summary and every entry of that agent, for good, and leaves the others", () => {
    const path = tempStorePath();
    const store = open({ path });
    store.putAgent(summary("gone"));
    store.putAgent(summary("stays"));
    store.append("gone", realisticTurn);
    store.append("stays", [textChunk("Still here.")]);
    const stays = store.readLog("stays");

    expect(store.deleteAgent("gone")).toEqual(expect.any(Number));
    expect(store.listAgents().map((agent) => agent.id)).toEqual(["stays"]);
    expect(store.readLog("gone")).toEqual({ entries: [], truncated: false });
    expect(() => store.append("gone", [textChunk("late")])).toThrow();
    expect(store.readLog("stays")).toEqual(stays);
    expect(store.deleteAgent("gone")).toBeUndefined();

    store.close();
    const reopened = open({ path });
    expect(reopened.listAgents().map((agent) => agent.id)).toEqual(["stays"]);
    // The same id added again starts with no history.
    reopened.putAgent(summary("gone"));
    expect(reopened.readLog("gone")).toEqual({ entries: [], truncated: false });
  });
});
