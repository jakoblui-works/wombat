// The log read's behaviour as one table (`GET /agents/:id/log?after=&limit=`, store.readLog), run against the
// service's real store (service/test/log-read-cases.test.ts) and against the desktop's fake bridge
// (desktop/test/log-read-cases.test.ts), so the fake the page's tests rely on can't drift from the service.
//
// Positions, not seqs: entry `p` is the agent's p-th stored entry (1-based) and 0 means "before the first"; each
// runner maps positions to the seqs its side handed out (the store's seq is store-wide).

export type LogReadCase = {
  name: string;
  /** How many entries the agent has stored (all the same size). */
  stored: number;
  /** The cap kept only the newest this many (dropping the older ones); absent: nothing dropped. */
  capKeepsNewest?: number;
  /** `after`, as a position. */
  after: number;
  /** `limit`: always sent, as the app does (the route's default isn't part of this table). */
  limit: number;
  /** The positions read, in order. */
  expected: number[];
  /** Whether the cap dropped an entry after `after`. */
  truncated: boolean;
};

export const LOG_READ_CASES: LogReadCase[] = [
  { name: "everything, from the start", stored: 5, after: 0, limit: 10, expected: [1, 2, 3, 4, 5], truncated: false },
  { name: "from a cursor in the middle", stored: 5, after: 2, limit: 10, expected: [3, 4, 5], truncated: false },
  { name: "from the last entry: nothing", stored: 5, after: 5, limit: 10, expected: [], truncated: false },
  { name: "a limit cuts the page", stored: 5, after: 0, limit: 2, expected: [1, 2], truncated: false },
  { name: "a limit past the end", stored: 5, after: 3, limit: 10, expected: [4, 5], truncated: false },
  { name: "an empty log", stored: 0, after: 0, limit: 10, expected: [], truncated: false },
  { name: "the cap dropped the oldest, read from the start", stored: 5, capKeepsNewest: 3, after: 0, limit: 10, expected: [3, 4, 5], truncated: true },
  { name: "a cursor before what the cap dropped", stored: 5, capKeepsNewest: 3, after: 1, limit: 10, expected: [3, 4, 5], truncated: true },
  { name: "a cursor at the last dropped entry", stored: 5, capKeepsNewest: 3, after: 2, limit: 10, expected: [3, 4, 5], truncated: false },
  { name: "a cursor past what the cap dropped, with a limit", stored: 5, capKeepsNewest: 3, after: 3, limit: 1, expected: [4], truncated: false },
];

/** Queries the route refuses with 400 `invalid_request` and an ErrorBody (the app never sends them). */
export const INVALID_LOG_QUERIES: string[] = ["?after=-1", "?after=x", "?limit=0", "?limit=1001", "?after=1&after=2", "?offset=3"];
