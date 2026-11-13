// Which chat blocks get the entrance motion, as the chat renders them over time: only blocks that arrive while the
// chat is open. What was there on first load, what a reconnect's read of the log brings back, and what is there after
// the model was reset just appears.
import { expect, test } from "vitest";

import { type Arrivals, type ArrivalsNow, NO_ARRIVALS, trackArrivals } from "./arrivals.ts";

test("only blocks that arrive live are fresh: not the first load, not a reconnect's catch-up, not after a reset", () => {
  let arrivals: Arrivals = NO_ARRIVALS;
  let keys: string[] = [];
  let now: ArrivalsNow = { loaded: false, connected: true, reading: true, readAt: 0 };
  /** One render of the chat with these blocks and this state of the log's read and the connection. */
  const render = (change: Partial<ArrivalsNow> & { add?: string[] } = {}): void => {
    const { add = [], ...rest } = change;
    keys = [...keys, ...add];
    now = { ...now, ...rest };
    arrivals = trackArrivals(arrivals, keys, now);
  };
  const fresh = (): string[] => keys.filter((key) => arrivals.fresh.has(key));

  // The first read is the baseline.
  render();
  render({ loaded: true, reading: false, readAt: 1, add: ["hello", "reply"] });
  expect(fresh()).toEqual([]);

  // A block added while connected arrives live.
  render({ readAt: 2, add: ["live"] });
  expect(fresh()).toEqual(["live"]);

  // The connection drops and comes back; what shows until the reconnect's read has been seen and has settled was
  // missed, not live: a block before the read starts, and one the read brings.
  render({ connected: false });
  render({ connected: true });
  render({ add: ["missed-early"] });
  render({ reading: true });
  render({ reading: false, readAt: 3, add: ["missed"] });
  expect(fresh()).toEqual(["live"]);
  render({ readAt: 4, add: ["after-catch-up"] });
  expect(fresh()).toEqual(["live", "after-catch-up"]);

  // A reconnect that missed nothing ends its catch-up too, also when the read finished between renders.
  render({ connected: false });
  render({ connected: true });
  render({ readAt: 5 });
  render({ readAt: 6, add: ["after-quiet-reconnect"] });
  expect(fresh()).toEqual(["live", "after-catch-up", "after-quiet-reconnect"]);

  // Without a model (the cache was reset) it starts over: the next read is a new baseline.
  render({ loaded: false, reading: true });
  render({ loaded: true, reading: false, readAt: 7, add: ["read-after-reset"] });
  expect(fresh()).toEqual([]);
  render({ readAt: 8, add: ["live-after-reset"] });
  expect(fresh()).toEqual(["live-after-reset"]);
});
