// T8: reading an agent's log (interface-S4, `useAgentLog` through its seam `agentLogQueryFn(agentId, cached?)`),
// against the fake bridge, which pages and caps like the service's readLog. What would fail silently: a long log cut
// at its first page (or at a page an unknown entry made shorter), a cached log re-read whole, a new store's entries
// merged into the old store's, and `truncated` read as "more pages" or lost.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { LogEntry } from "@wombat/shared/api";
import { fakeService, type FakeService } from "../../../../test/fake-bridge.ts";
import { type Body, chunk, MALFORMED, turnEnded, UNSHOWN, user } from "../../../../../shared/test/log-entries.ts";
import { chatModel } from "./chat-model.ts";
import { agentLogQueryFn } from "./query-client.ts";

const A = "agent-bakery-1";
const UNKNOWN = UNSHOWN.find((body) => (body as { type: string }).type === "future_entry") as Body;

let service: FakeService;
beforeEach(() => {
  service = fakeService();
  vi.stubGlobal("window", { wombat: service.bridge });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Read = { after: number; limit: string | null };
const logReads = (from = 0): Read[] =>
  service
    .requests()
    .slice(from)
    .filter(({ path }) => path.startsWith(`/agents/${A}/log`))
    .map(({ path }) => {
      const params = new URL(path, "http://x").searchParams;
      return { after: Number(params.get("after") ?? "0"), limit: params.get("limit") };
    });

const known = (list: LogEntry[]): LogEntry[] => list.filter((entry) => (entry as { type: string }).type !== "future_entry");
const chunks = (n: number, label: string): Body[] => Array.from({ length: n }, (_, i) => chunk(`${label} ${String(i)}`));

/** The page size the client sends, learned from one read (it's the client's named constant). */
const pageSize = async (): Promise<number> => {
  const probe = fakeService();
  probe.append(A, user("probe"));
  vi.stubGlobal("window", { wombat: probe.bridge });
  await agentLogQueryFn(A);
  vi.stubGlobal("window", { wombat: service.bridge });
  const sent = probe.requests().map(({ path }) => new URL(path, "http://x").searchParams.get("limit"));
  expect(sent.length, "the read sent no request").toBeGreaterThan(0);
  expect(sent.every((limit) => limit !== null && /^\d+$/.test(limit)), `a log read without an explicit limit: ${JSON.stringify(sent)}`).toBe(true);
  return Number(sent[0]);
};

test("a first load pages from 0 with an explicit limit until the log is read, even past a page an unknown entry made shorter", async () => {
  const limit = await pageSize();
  // The first page's last raw entry is unknown: it parses one short of `limit`, and more pages follow.
  service.append(A, user("Fix the hours"), ...chunks(limit - 2, "a"), UNKNOWN, ...chunks(limit + 3, "b"));

  const log = await agentLogQueryFn(A);

  expect(log.entries).toEqual(known(service.log(A)));
  expect(log.dbId).toBe(service.dbId());
  expect(log.truncated).toBe(false);
  const reads = logReads();
  expect(reads[0]?.after).toBe(0);
  expect(reads.length).toBeGreaterThanOrEqual(3);
  expect(reads.every((read) => read.limit === String(limit))).toBe(true);
});

test("with a cached log of the same store it reads from the cached cursor and appends", async () => {
  const limit = await pageSize();
  service.append(A, user("Fix the hours"), chunk("Looking"));
  const cached = await agentLogQueryFn(A);
  const cursor = Math.max(...cached.entries.map((entry) => entry.seq));
  const before = service.requests().length;
  service.append(A, ...chunks(limit + 2, "more"));

  const log = await agentLogQueryFn(A, cached);

  expect(log.entries).toEqual(service.log(A));
  const reads = logReads(before);
  expect(reads[0]?.after).toBe(cursor);
  expect(reads.map((read) => read.after)).not.toContain(0);
});

test("a cached log from another store is dropped and the log reloaded from 0", async () => {
  service.append(A, user("old one"), chunk("old two"), chunk("old three"));
  const cached = await agentLogQueryFn(A);
  service.newStore("db-2");
  // More entries than the old cursor: appending after it would keep the old store's first three.
  service.append(A, user("new one"), ...chunks(5, "new"));

  const log = await agentLogQueryFn(A, cached);

  expect(log.dbId).toBe("db-2");
  expect(log.entries).toEqual(service.log(A));
});

test("truncated says the service's cap dropped entries after the cursor", async () => {
  // From 0, with the oldest entries dropped: earlier history is gone.
  service.append(A, user("one"), chunk("two"), chunk("three"), chunk("four"));
  service.capDrop(A, 2);
  const fromStart = await agentLogQueryFn(A);
  expect(fromStart.truncated).toBe(true);
  expect(fromStart.entries).toEqual(service.log(A));

  // Cached past what the cap dropped: nothing after the cursor is missing.
  const other = fakeService();
  vi.stubGlobal("window", { wombat: other.bridge });
  other.append(A, user("one"), chunk("two"), chunk("three"), chunk("four"), chunk("five"));
  const cached = await agentLogQueryFn(A);
  other.append(A, chunk("six"));
  other.capDrop(A, 3);
  expect((await agentLogQueryFn(A, cached)).truncated).toBe(false);

  // Cached before what the cap dropped: a gap after the cursor.
  const gap = fakeService();
  vi.stubGlobal("window", { wombat: gap.bridge });
  gap.append(A, user("one"), chunk("two"));
  const early = await agentLogQueryFn(A);
  gap.append(A, chunk("three"), chunk("four"), chunk("five"));
  gap.capDrop(A, 4);
  expect((await agentLogQueryFn(A, early)).truncated).toBe(true);
});

test("a malformed known entry doesn't fail the read: it shows as an unreadable item, and the rest of the log reads on", async () => {
  const [, bad] = service.append(A, user("Fix the hours"), MALFORMED, chunk("Done"), turnEnded());

  const log = await agentLogQueryFn(A);
  const model = chatModel(log.entries);

  expect(model.items.map((item) => item.kind as string)).toEqual(["user", "unreadable", "agent", "turn_end"]);
  const unreadable = model.items[1];
  expect(unreadable?.at).toBe(bad?.at);
  // No content of the entry it stands for.
  expect(Object.keys(unreadable ?? {}).filter((key) => !["kind", "key", "at", "sessionId"].includes(key))).toEqual([]);
});
