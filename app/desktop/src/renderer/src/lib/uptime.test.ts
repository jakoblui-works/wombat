import { expect, test } from "vitest";

import { uptimeLabel } from "./uptime.ts";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const MIN = 60_000;
const at = (ms: number) => new Date(NOW - ms).toISOString();

test.each([
  [0, "under a minute"],
  [59_999, "under a minute"],
  [MIN, "1 min"],
  [4 * MIN, "4 min"],
  [59 * MIN, "59 min"],
  [60 * MIN, "1 h"],
  [375 * MIN, "6 h 15 min"],
  [24 * 60 * MIN, "1 d"],
  [(2 * 24 * 60 + 3 * 60 + 40) * MIN, "2 d 3 h"],
])("uptimeLabel of %i ms is %s", (ms, label) => {
  expect(uptimeLabel(at(ms), NOW)).toBe(label);
});

test("a start in the future reads as under a minute", () => {
  expect(uptimeLabel(at(-5 * MIN), NOW)).toBe("under a minute");
});
