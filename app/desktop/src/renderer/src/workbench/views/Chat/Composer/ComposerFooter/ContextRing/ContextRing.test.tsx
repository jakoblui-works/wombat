// T6-3: the ring's share is clamped to 0-1 (size 0 is empty); the tooltip text has tokens and the cost when there is one.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ContextRing, contextShare, usageLabel } from "./ContextRing.tsx";

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

test("the label has used / size tokens, and the cost only when present", () => {
  expect(usageLabel({ used: 1200, size: 200000 })).toBe("1,200 / 200,000 tokens");
  expect(usageLabel({ used: 1, size: 2, cost: null })).toBe("1 / 2 tokens");
  expect(usageLabel({ used: 1, size: 2, cost: { amount: 0.5, currency: "USD" } })).toBe("1 / 2 tokens, $0.50");
});
