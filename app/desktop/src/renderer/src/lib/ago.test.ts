import { expect, test } from "vitest";

import { ago } from "./ago.ts";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();

test("ago moves up a unit at each boundary", () => {
  expect(ago(before(0), NOW)).toBe("now");
  expect(ago(before(59_999), NOW)).toBe("now");
  expect(ago(before(60_000), NOW)).toBe("1m");
  expect(ago(before(3_599_999), NOW)).toBe("59m");
  expect(ago(before(3_600_000), NOW)).toBe("1h");
  expect(ago(before(86_399_999), NOW)).toBe("23h");
  expect(ago(before(86_400_000), NOW)).toBe("1d");
  expect(ago(before(3 * 86_400_000 + 5), new Date(NOW))).toBe("3d");
});

test("a time in the future or an unreadable one reads as now", () => {
  expect(ago(before(-5_000), NOW)).toBe("now");
  expect(ago("not a time", NOW)).toBe("now");
});
