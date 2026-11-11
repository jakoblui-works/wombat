// The discovery file: how the app finds the running service.
import { describe, expect, test } from "vitest";

import { DiscoveryFile } from "./discovery.ts";

// Invented values: a running service as it would write $XDG_RUNTIME_DIR/wombat/service.json.
const sample = {
  apiVersion: 1,
  port: 14900,
  pid: 48213,
  token: "q7Zk3vR9xW2mN8pL5tY1uB4cF6hJ0aSd",
};

describe("DiscoveryFile", () => {
  test("accepts the whole valid TCP port range", () => {
    for (const port of [1, 65535]) {
      expect(DiscoveryFile.safeParse({ ...sample, port }).success, String(port)).toBe(true);
    }
  });

  test("rejects ports that are not valid TCP ports", () => {
    for (const port of [0, -1, 65536, 14900.5, "14900", Number.NaN]) {
      expect(DiscoveryFile.safeParse({ ...sample, port }).success, String(port)).toBe(false);
    }
  });

  test("ignores unknown fields", () => {
    expect(DiscoveryFile.parse({ ...sample, startedAt: "2026-11-04T09:00:00.000Z" })).toMatchObject(sample);
  });
});
