// The one way to say "this key changed, read it again". A read under way may have been answered before the change,
// and TanStack joins it rather than starting another (invalidateQueries does too, for a query without data), so the
// change would be lost: a refresh waits that read out, then reads once more. Refreshes of one key run one at a time;
// those asked for meanwhile become one more read.
import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { queryFor } from "./query-client.ts";

type Running = { again: boolean; done: Promise<void> };

const runningByClient = new WeakMap<QueryClient, Map<string, Running>>();

/** Reads `queryKey` again if the cache holds it (data, an error or a view on it); settles once read. */
export const refresh = (queryClient: QueryClient, queryKey: QueryKey): Promise<void> => {
  const query = queryFor(queryClient, queryKey);
  if (query === undefined) return Promise.resolve();
  let running = runningByClient.get(queryClient);
  if (running === undefined) {
    running = new Map();
    runningByClient.set(queryClient, running);
  }
  const hash = hashKey(queryKey);
  const under = running.get(hash);
  if (under !== undefined) {
    under.again = true;
    return under.done;
  }

  const held = () => queryClient.getQueryCache().find({ queryKey, exact: true });
  // A failed read stays in the query's error state; the next alert or connection reads again.
  const read = () => queryClient.fetchQuery({ ...query, staleTime: 0 }).then(
    () => undefined,
    () => undefined,
  );
  const entry: Running = { again: false, done: Promise.resolve() };
  const byKey = running;
  // Registered before the body runs: its first lines (and its finally) can run before this function returns.
  running.set(hash, entry);
  entry.done = (async () => {
    try {
      if (held()?.state.fetchStatus === "fetching") await read();
      do {
        entry.again = false;
        if (held() === undefined) return;
        await read();
      } while (entry.again);
    } finally {
      byKey.delete(hash);
    }
  })();
  return entry.done;
};
