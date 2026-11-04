import { expect, test } from "vitest";

import { API_VERSION } from "./index.ts";

test("API_VERSION is a positive integer", () => {
  expect(Number.isInteger(API_VERSION)).toBe(true);
  expect(API_VERSION).toBeGreaterThan(0);
});
