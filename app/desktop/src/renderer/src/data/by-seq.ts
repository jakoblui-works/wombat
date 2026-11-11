// The one ordering of log entries: by seq, each seq once. A seq read again (a reconnect re-reading from a cursor)
// replaces the copy before it.

/** `entries` sorted by seq, one per seq; of two with the same seq, the later one in `entries` is kept. */
export const bySeq = <T extends { seq: number }>(entries: readonly T[]): T[] => {
  const kept = new Map<number, T>();
  for (const entry of entries) kept.set(entry.seq, entry);
  return [...kept.values()].sort((a, b) => a.seq - b.seq);
};
