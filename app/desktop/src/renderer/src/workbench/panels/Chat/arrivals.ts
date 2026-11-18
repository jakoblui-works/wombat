// Which of the chat's blocks arrived while the chat was open, pure: those get the entrance motion. What was there on
// first load, or is read after the connection came back (a catch-up), or after the cache was reset, just appears.

export type Arrivals = {
  /** The log has been read: the first set of blocks is the baseline. */
  loaded: boolean;
  /** The connection as of the last render. */
  connected: boolean;
  /** When the log was last read, as of the last render (`dataUpdatedAt`). */
  readAt: number;
  /** The connection came back: blocks that show up until its read of the log has settled are what was missed. */
  catchingUp: boolean;
  /** `readAt` as the connection came back; a later one means the reconnect's read has been done. */
  readAtReconnect: number;
  /** The reconnect's read has been seen, under way or done. */
  readSeen: boolean;
  /** Every block key seen so far. */
  seen: ReadonlySet<string>;
  /** The keys of the blocks that arrived live. */
  fresh: ReadonlySet<string>;
};

export const NO_ARRIVALS: Arrivals = { loaded: false, connected: true, readAt: 0, catchingUp: false, readAtReconnect: 0, readSeen: false, seen: new Set(), fresh: new Set() };

/** What a render knows besides the blocks: the log's read (the query's state) and the connection. */
export type ArrivalsNow = { loaded: boolean; connected: boolean; reading: boolean; readAt: number };

/**
 * The arrivals after a render with `keys`: the same object when nothing changed, so it can sit in state. Without a
 * model (not read yet, or the cache was reset) it starts over. After the connection came back, the data layer reads
 * every cached log again (data/alerts.ts); the catch-up lasts until that read has been seen and has settled, so the
 * blocks it brings are not arrivals and the next block after it is.
 */
export const trackArrivals = (before: Arrivals, keys: readonly string[], now: ArrivalsNow): Arrivals => {
  if (!now.loaded) return before.loaded || before.connected !== now.connected ? { ...NO_ARRIVALS, connected: now.connected, readAt: now.readAt } : before;
  if (!before.loaded) return { ...NO_ARRIVALS, loaded: true, connected: now.connected, readAt: now.readAt, seen: new Set(keys) };
  let next = before;
  if (now.connected !== before.connected) {
    next = { ...next, connected: now.connected, ...(now.connected ? { catchingUp: true, readSeen: false, readAtReconnect: before.readAt } : {}) };
  }
  if (next.catchingUp && now.connected && !next.readSeen && (now.reading || now.readAt !== next.readAtReconnect)) next = { ...next, readSeen: true };
  if (next.readAt !== now.readAt) next = { ...next, readAt: now.readAt };
  const settled = next.catchingUp && next.readSeen && now.connected && !now.reading;
  const added = keys.filter((key) => !next.seen.has(key));
  if (added.length > 0) {
    next = { ...next, seen: new Set([...next.seen, ...added]), ...(next.catchingUp ? {} : { fresh: new Set([...next.fresh, ...added]) }) };
  }
  return settled ? { ...next, catchingUp: false } : next;
};
