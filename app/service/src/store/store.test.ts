// The store: agent summaries and an append-only log of items, read back after a cursor.
import { Item } from "@wombat/shared/api";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { ItemEntry } from "./store.ts";
import {
  fakeClock,
  open,
  realisticTurn,
  summary,
  tempDir,
  tempStorePath,
  textChunk,
  type Store,
} from "../../test/store-fixtures.ts";

const textOf = (item: Item) =>
  item.type === "session_update" && item.update.sessionUpdate === "agent_message_chunk" && item.update.content.type === "text"
    ? item.update.content.text
    : undefined;

describe("append", () => {
  test("a batch gets consecutive seqs in entry order", () => {
    const store = open({ path: tempStorePath() });
    store.putAgent(summary("a1"));
    const before = store.currentSeq();

    const seqs = store.append("a1", realisticTurn);

    expect(seqs).toEqual(realisticTurn.map((_, index) => before + 1 + index));
    const { items } = store.items("a1");
    expect(items.map((item) => item.seq)).toEqual(seqs);
    expect(items.map((item) => item.type)).toEqual(realisticTurn.map((entry) => entry.type));
  });

  test("a batch that fails stores nothing: no items, no seq taken", () => {
    const store = open({ path: tempStorePath() });
    store.putAgent(summary("a1"));
    store.append("a1", [textChunk("kept")]);
    const seqBefore = store.currentSeq();
    const itemsBefore = store.items("a1");

    // The middle entry can't be serialized.
    const unserializable = { type: "user_message", text: 10n } as unknown as ItemEntry;
    expect(() => store.append("a1", [textChunk("first"), unserializable, textChunk("last")])).toThrow();
    expect(() => store.append("ghost", [textChunk("to nobody")])).toThrow();

    expect(store.currentSeq()).toBe(seqBefore);
    expect(store.items("a1")).toEqual(itemsBefore);
    expect(store.items("ghost")).toEqual({ items: [], truncated: false });
    expect(store.append("a1", [textChunk("next")])).toEqual([seqBefore + 1]);
  });
});

describe("persistence", () => {
  test("reopening keeps dbId, currentSeq, the latest summaries and every item", () => {
    const path = tempStorePath();
    const store = open({ path, now: fakeClock() });
    store.putAgent(summary("a1"));
    store.putAgent(summary("a2", { repo: "cv-web" }));
    store.append("a1", realisticTurn);
    store.append("a2", [textChunk("Looking at the CV layout."), textChunk("Done.")]);
    store.putAgent(summary("a1", { state: "working", title: "Footer link", lastActivityAt: "2026-11-09T09:30:00.000Z" }));
    const before = {
      dbId: store.dbId,
      seq: store.currentSeq(),
      agents: store.listAgents(),
      a1: store.items("a1"),
      a2: store.items("a2"),
    };
    store.close();

    const reopened = open({ path, now: fakeClock() });
    expect({
      dbId: reopened.dbId,
      seq: reopened.currentSeq(),
      agents: reopened.listAgents(),
      a1: reopened.items("a1"),
      a2: reopened.items("a2"),
    }).toEqual(before);
    expect(before.a1.items).toHaveLength(realisticTurn.length);
    expect(before.a2.items).toHaveLength(2);
  });

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

  test("listAgents returns each agent's latest summary once, ordered by startedAt then id", () => {
    const store = open({ path: tempStorePath() });
    const late = summary("a", { startedAt: "2026-11-09T09:10:00.000Z", lastActivityAt: "2026-11-09T09:10:00.000Z" });
    const c = summary("c", { startedAt: "2026-11-09T09:00:00.000Z" });
    const b = summary("b", { startedAt: "2026-11-09T09:00:00.000Z" });
    const bLater = { ...b, state: "error" as const, error: { code: "agent_exited", message: "The agent stopped." } };
    for (const agent of [late, c, b, bLater]) store.putAgent(agent);

    expect(store.listAgents()).toEqual([bLater, c, late]);
  });
});

describe("items", () => {
  test("returns exactly this agent's items after the cursor, oldest first, at most limit", () => {
    const agents = ["a1", "a2", "a3"];
    fc.assert(
      fc.property(
        fc.array(fc.record({ agent: fc.integer({ min: 0, max: 2 }), count: fc.integer({ min: 1, max: 3 }) }), {
          maxLength: 15,
        }),
        fc.array(
          fc.record({
            // 3 is an agent the store has never seen.
            agent: fc.integer({ min: 0, max: 3 }),
            after: fc.nat(),
            limit: fc.option(fc.integer({ min: 1, max: 8 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (appends, queries) => {
          const store: Store = open({ path: tempStorePath() });
          const model: { seq: number; agentId: string; text: string }[] = [];
          for (const id of agents) store.putAgent(summary(id));
          for (const [n, { agent, count }] of appends.entries()) {
            const id = agents[agent] ?? "a1";
            const texts = Array.from({ length: count }, (_, index) => `${id} batch ${n} chunk ${index}`);
            const seqs = store.append(id, texts.map((text) => textChunk(text)));
            texts.forEach((text, index) => model.push({ seq: seqs[index] ?? -1, agentId: id, text }));
          }

          for (const query of queries) {
            const id = agents[query.agent] ?? "never-seen";
            const after = query.after % (store.currentSeq() + 3);
            const expected = model
              .filter((item) => item.agentId === id && item.seq > after)
              .slice(0, query.limit ?? Number.POSITIVE_INFINITY);
            const result = store.items(id, after, query.limit);
            expect(result.truncated).toBe(false);
            expect(result.items.map((item) => ({ seq: item.seq, agentId: item.agentId, text: textOf(item) }))).toEqual(
              expected,
            );
          }
          for (const id of agents) expect(store.items(id)).toEqual(store.items(id, 0));
          store.close();
        },
      ),
      { numRuns: 40 },
    );
  });

  test("come back as valid shared Items, unchanged, with at defaulting to now", () => {
    const now = new Date("2026-11-09T12:34:56.000Z");
    const store = open({ path: tempStorePath(), now: () => now });
    store.putAgent(summary("a1"));
    const withoutAt = textChunk("No timestamp given.");

    const seqs = store.append("a1", [...realisticTurn, withoutAt]);
    const { items } = store.items("a1");

    expect(items).toHaveLength(realisticTurn.length + 1);
    for (const item of items) expect(Item.parse(item)).toEqual(item);
    expect(items.slice(0, realisticTurn.length)).toEqual(
      realisticTurn.map((entry, index) => ({ ...entry, seq: seqs[index], agentId: "a1" })),
    );
    const last = items.at(-1);
    expect(last).toMatchObject({ ...withoutAt, seq: seqs.at(-1), agentId: "a1" });
    expect(Date.parse(last?.at ?? "")).toBe(now.getTime());
  });
});

describe("the per-agent size cap", () => {
  /** A cap chosen by the test; the product's constant is never assumed. */
  const CAP = 4096;

  test("past the cap the oldest items go, the newest stay, other agents are untouched, and truncated says so", () => {
    const store = open({ path: tempStorePath(), maxItemBytesPerAgent: CAP });
    store.putAgent(summary("big"));
    store.putAgent(summary("small"));
    const smallChunks = ["one", "two", "three", "four"].map((word) => textChunk(`${word} ${"s".repeat(CAP / 16)}`));
    const smallSeqs = [...store.append("small", smallChunks.slice(0, 2))];

    const bigSeqs = store.append(
      "big",
      Array.from({ length: 20 }, (_, index) => textChunk(`chunk ${index} ${"b".repeat(CAP / 4)}`)),
    );
    smallSeqs.push(...store.append("small", smallChunks.slice(2)));

    const kept = store.items("big").items;
    const keptSeqs = kept.map((item) => item.seq);
    expect(keptSeqs.length).toBeGreaterThan(0);
    expect(keptSeqs.length).toBeLessThan(bigSeqs.length);
    // Oldest deleted first: what's kept is the newest run of the batch.
    expect(keptSeqs).toEqual(bigSeqs.slice(bigSeqs.length - keptSeqs.length));
    expect(kept.reduce((bytes, item) => bytes + Buffer.byteLength(textOf(item) ?? ""), 0)).toBeLessThanOrEqual(CAP);

    const oldestKept = keptSeqs[0] ?? 0;
    expect(store.items("big", 0).truncated).toBe(true);
    expect(store.items("big", oldestKept - 2).truncated).toBe(true);
    expect(store.items("big", oldestKept - 1)).toEqual({ items: kept, truncated: false });

    expect(store.items("small")).toMatchObject({ truncated: false });
    expect(store.items("small").items.map((item) => item.seq)).toEqual(smallSeqs);
  });

  test("the newest item survives even when it alone is over the cap", () => {
    const store = open({ path: tempStorePath(), maxItemBytesPerAgent: CAP });
    store.putAgent(summary("a1"));
    store.append("a1", [textChunk("first"), textChunk("second")]);
    const [hugeSeq] = store.append("a1", [textChunk(`huge ${"h".repeat(CAP * 2)}`)]);

    const result = store.items("a1");
    expect(result.items.map((item) => item.seq)).toEqual([hugeSeq]);
    expect(result.truncated).toBe(true);
  });
});

describe("deleteAgent", () => {
  test("removes the summary and every item of that agent, for good, and leaves the others", () => {
    const path = tempStorePath();
    const store = open({ path });
    store.putAgent(summary("gone"));
    store.putAgent(summary("stays"));
    store.append("gone", realisticTurn);
    store.append("stays", [textChunk("Still here.")]);
    const stays = store.items("stays");

    expect(store.deleteAgent("gone")).toEqual(expect.any(Number));
    expect(store.listAgents().map((agent) => agent.id)).toEqual(["stays"]);
    expect(store.items("gone")).toEqual({ items: [], truncated: false });
    expect(() => store.append("gone", [textChunk("late")])).toThrow();
    expect(store.items("stays")).toEqual(stays);
    expect(store.deleteAgent("gone")).toBeUndefined();

    store.close();
    const reopened = open({ path });
    expect(reopened.listAgents().map((agent) => agent.id)).toEqual(["stays"]);
    // The same id added again starts with no history.
    reopened.putAgent(summary("gone"));
    expect(reopened.items("gone")).toEqual({ items: [], truncated: false });
  });
});
