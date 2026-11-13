// The page's connection states: a subscriber gets the current state at once, then each newer one.
import { expect, test } from "vitest";

import type { ConnectionState } from "../shared/bridge.ts";
import { connectionFeed } from "./connection-feed.ts";

test("a late subscriber gets the current state at once, then the changes after it", () => {
  const feed = connectionFeed();
  feed.take({ seq: 1, state: { state: "connecting" } });
  feed.take({ seq: 2, state: { state: "connected" } });

  const seen: ConnectionState[] = [];
  feed.subscribe((state) => seen.push(state));
  feed.take({ seq: 3, state: { state: "reconnecting" } });

  expect(seen).toEqual([{ state: "connected" }, { state: "reconnecting" }]);
});

test("a state older than the latest one (the answer to the load-time ask, arriving late) is dropped", () => {
  const feed = connectionFeed();
  const seen: ConnectionState[] = [];
  feed.subscribe((state) => seen.push(state));
  feed.take({ seq: 4, state: { state: "connected" } });
  feed.take({ seq: 3, state: { state: "connecting" } });

  expect(seen).toEqual([{ state: "connected" }]);
});
