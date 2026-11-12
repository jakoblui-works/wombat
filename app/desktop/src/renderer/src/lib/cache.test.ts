// S2c, T15 (row T15-2): cache time left, which the ring's label and its muted state both read. A property over any
// TTL, request time and moment after it: the seconds left are the TTL less the time since the request (to within a
// second's rounding), never negative, and the cache has expired exactly once the TTL has passed.
import fc from "fast-check";
import { expect, test } from "vitest";

import { cacheLeft } from "./cache.ts";

test("seconds left are ttl minus the time since the request, never negative; expired once the ttl has passed", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 7200 }),
      fc.integer({ min: Date.parse("2025-01-01T00:00:00Z"), max: Date.parse("2030-01-01T00:00:00Z") }),
      fc.integer({ min: 0, max: 4 * 7200 * 1000 }),
      (ttlSeconds, requestedAt, elapsedMs) => {
        const left = cacheLeft({ ttlSeconds, lastRequestAt: new Date(requestedAt).toISOString() }, requestedAt + elapsedMs);
        const expired = elapsedMs >= ttlSeconds * 1000;
        expect(left.expired).toBe(expired);
        expect(left.seconds).toBeGreaterThanOrEqual(0);
        expect(Math.abs(left.seconds - Math.max(0, ttlSeconds - elapsedMs / 1000))).toBeLessThan(1);
        if (expired) expect(left.seconds).toBe(0);
      },
    ),
  );
});
