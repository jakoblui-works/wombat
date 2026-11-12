/** The cache state as AgentSummary.cache carries it. */
export type CacheState = { ttlSeconds: number; lastRequestAt: string };

/** How long the prompt cache has left at `now` (ms since the epoch), and whether it has expired. */
export const cacheLeft = (cache: CacheState, now: number): { expired: boolean; seconds: number } => {
  const elapsedMs = now - Date.parse(cache.lastRequestAt);
  // A request time that can't be read counts as long ago: the cache isn't claimed to be alive.
  if (Number.isNaN(elapsedMs) || elapsedMs >= cache.ttlSeconds * 1000) return { expired: true, seconds: 0 };
  return { expired: false, seconds: cache.ttlSeconds - Math.max(0, elapsedMs) / 1000 };
};
