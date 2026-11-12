// T6-3: the ring's share is clamped to 0-1 (size 0 is empty); the tooltip text has tokens and never a price (S2c, T15-5).
// S2c, T15-1: the ring's level for a share, by the exported thresholds.
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ContextRing, contextShare, RING_FULL_SHARE, RING_WARN_SHARE, ringLevel, sharePercent, usageLabel } from "./ContextRing.tsx";

test("the share is used over size, clamped to 0-1, and empty for a size of 0", () => {
  expect(contextShare({ used: 50, size: 200 })).toBe(0.25);
  expect(contextShare({ used: 500, size: 200 })).toBe(1);
  expect(contextShare({ used: -5, size: 200 })).toBe(0);
  expect(contextShare({ used: 10, size: 0 })).toBe(0);
});

test("the ring draws the clamped share as an arc", () => {
  const arc = (used: number, size: number) => {
    const html = renderToStaticMarkup(<ContextRing usage={{ used, size }} />);
    const [drawn, whole] = /data-slot="context-ring-used"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(html)?.slice(1).map(Number) ?? [];
    return (drawn ?? NaN) / (whole ?? NaN);
  };
  expect(arc(100, 100)).toBeCloseTo(1);
  expect(arc(900, 100)).toBeCloseTo(1);
  expect(arc(5, 0)).toBe(0);
});

test("the label has used / size tokens, and never a price", () => {
  expect(usageLabel({ used: 1200, size: 200000 })).toBe("1,200 / 200,000 tokens");
  expect(usageLabel({ used: 1, size: 2, cost: null })).toBe("1 / 2 tokens");
  expect(usageLabel({ used: 1, size: 2, cost: { amount: 0.5, currency: "USD" } })).toBe("1 / 2 tokens");
});

test("T15-1: the ring is normal below the warn share, warns from it, and is full from the full share", () => {
  expect(RING_WARN_SHARE).toBeLessThan(RING_FULL_SHARE);
  expect(ringLevel(0)).toBe("normal");
  expect(ringLevel(RING_WARN_SHARE)).toBe("warn");
  expect(ringLevel(RING_FULL_SHARE)).toBe("full");
  expect(ringLevel(1)).toBe("full");
  fc.assert(
    fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (share) => {
      expect(ringLevel(share)).toBe(share >= RING_FULL_SHARE ? "full" : share >= RING_WARN_SHARE ? "warn" : "normal");
    }),
  );
});

test("the percent text is whole percent, <1% when used but tiny, capped at 100%, and 0% for a size of 0", () => {
  expect(sharePercent({ used: 27160, size: 1000000 })).toBe("3%");
  expect(sharePercent({ used: 5, size: 1000 })).toBe("<1%");
  expect(sharePercent({ used: 0, size: 1000 })).toBe("0%");
  expect(sharePercent({ used: 500, size: 200 })).toBe("100%");
  expect(sharePercent({ used: 10, size: 0 })).toBe("0%");
});

test("the ring shows the percent text beside the arc, in the same trigger", () => {
  expect(renderToStaticMarkup(<ContextRing usage={{ used: 50, size: 200 }} />)).toContain(">25%</span>");
});
