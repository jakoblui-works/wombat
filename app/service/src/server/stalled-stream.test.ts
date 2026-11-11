// Lasting check (contract "bounded alert queue", silent failure): an /events client that stops reading is dropped
// once its queue passes the cap: its stream ends (so the app sees it and reconnects), it's unsubscribed (so it
// holds no memory), and what it did get is an unbroken run of seqs it can catch up from. Clients that keep reading
// are never dropped, and a stream opened after the drop gets the next alert. Without it, one stalled window grows
// the service's memory without end, or a dropped client waits forever on a stream that will never speak again.
import { describe, expect, onTestFinished, test } from "vitest";

import type { Committed } from "../agents/manager.ts";
import { WAIT_MS } from "../../test/manager-fixtures.ts";
import { createAlertStreams } from "./events.ts";

// A bound on the test, not the cap: the cap is the service's choice, but a client this far behind (a few MB of
// alerts) must have been dropped.
const MAX_ALERTS = 100_000;

/** The manager's onCommitted seam: listeners in subscription order, each with whether it's still subscribed. */
const fakeCommits = () => {
  const listeners: { listener: (event: Committed) => void; subscribed: boolean }[] = [];
  let seq = 0;
  return {
    onCommitted: (listener: (event: Committed) => void) => {
      const entry = { listener, subscribed: true };
      listeners.push(entry);
      return () => {
        entry.subscribed = false;
      };
    },
    commit: () => {
      seq += 1;
      for (const entry of [...listeners]) if (entry.subscribed) entry.listener({ seq, agentId: "agent-1", type: "log" });
      return seq;
    },
    subscribed: (index: number) => listeners[index]?.subscribed === true,
  };
};

const seqsIn = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));

/** Reads the stream in the background, as a live app would. */
const reading = (response: Response) => {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  // Only the unfinished tail is kept, so a long run stays cheap.
  let tail = "";
  let last = 0;
  let ended = false;
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tail += decoder.decode(value, { stream: true });
      const cut = tail.lastIndexOf("\n\n");
      if (cut === -1) continue;
      last = seqsIn(tail.slice(0, cut)).at(-1) ?? last;
      tail = tail.slice(cut + 2);
    }
  })()
    .catch(() => undefined)
    .finally(() => (ended = true));
  return { last: () => last, ended: () => ended };
};

/** Reads whatever is left of the stream; fails if it doesn't end (done or errored) within WAIT_MS. */
const drain = async (response: Response) => {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), Math.max(0, deadline - Date.now())));
    const next = await Promise.race([reader.read().catch((): Awaited<ReturnType<typeof reader.read>> => ({ done: true, value: undefined })), timeout]);
    if (next === "timeout") throw new Error("the dropped client's stream never ended");
    if (next.done) break;
    chunks.push(decoder.decode(next.value, { stream: true }));
  }
  return seqsIn(chunks.join(""));
};

const yieldUntil = async (check: () => boolean) => {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the reading client");
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe("alert stream queue", () => {
  test("a client that stops reading is dropped past the cap; a reading client stays, and a new stream gets the next alert", async () => {
    const commits = fakeCommits();
    const streams = createAlertStreams({ onCommitted: commits.onCommitted, dbId: "db-1", heartbeatMs: 3_600_000 });
    onTestFinished(() => streams.closeAll());

    const stalled = streams.respond(); // listener 0: never read until the end
    const live = reading(streams.respond()); // listener 1

    let sent = 0;
    while (commits.subscribed(0) && sent < MAX_ALERTS) {
      sent = commits.commit();
      await yieldUntil(() => live.last() === sent);
    }

    expect(commits.subscribed(0), `the stalled client was still subscribed after ${String(sent)} alerts`).toBe(false);
    const got = await drain(stalled);
    expect(got, "what the dropped client got is an unbroken run from the first alert").toEqual(got.map((_, index) => index + 1));
    expect(got.length).toBeLessThan(sent);

    expect(commits.subscribed(1), "the reading client is not dropped").toBe(true);
    expect(live.ended()).toBe(false);
    const reconnected = reading(streams.respond()); // listener 2
    const next = commits.commit();
    await yieldUntil(() => live.last() === next && reconnected.last() === next);
    expect(commits.subscribed(0), "the dropped client stays unsubscribed").toBe(false);
  });
});
