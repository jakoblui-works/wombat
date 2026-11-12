// The ring's cache line and muted state follow `cacheLeft`, read from the clock.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ContextRing } from "./ContextRing.tsx";

const NOW = Date.parse("2026-11-12T10:00:00Z");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

const render = (cache?: { ttlSeconds: number; lastRequestAt: string } | null) =>
  renderToStaticMarkup(<ContextRing usage={{ used: 50, size: 200 }} agent={cache === undefined ? {} : { cache }} />);
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

test("a live cache shows its ttl and the minutes left, at full strength", () => {
  const html = render({ ttlSeconds: 3600, lastRequestAt: ago(18 * 60) });
  expect(html).toContain("Cache 1h · 42 min left");
  expect(html).not.toContain("data-cache-expired");
});

test("an expired cache says so and mutes the ring", () => {
  const html = render({ ttlSeconds: 300, lastRequestAt: ago(301) });
  expect(html).toContain("Cache expired");
  expect(html).toContain("data-cache-expired");
});

test("without a cache the ring has no cache line and isn't muted", () => {
  for (const cache of [undefined, null]) {
    const html = render(cache);
    expect(html).not.toContain("Cache");
    expect(html).not.toContain("data-cache-expired");
  }
});

test("the arc turns amber near the limit and red at it", () => {
  const level = (used: number) => /data-level="(\w+)"/.exec(renderToStaticMarkup(<ContextRing usage={{ used, size: 100 }} />))?.[1];
  expect([level(50), level(85), level(97)]).toEqual(["normal", "warn", "full"]);
});
