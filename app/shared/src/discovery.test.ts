// Task 1 (wire contract): every test in this file belongs to step 4, task 1.
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
  test("accepts what a running service writes", () => {
    expect(DiscoveryFile.parse(sample)).toMatchObject(sample);
    expect(DiscoveryFile.parse(JSON.parse(JSON.stringify(sample)))).toMatchObject(sample);
  });

  test("accepts the whole valid TCP port range", () => {
    for (const port of [1, 65535]) {
      expect(DiscoveryFile.safeParse({ ...sample, port }).success, String(port)).toBe(true);
    }
  });

  test("rejects a missing field", () => {
    for (const field of ["apiVersion", "port", "pid", "token"]) {
      const partial = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field));
      expect(DiscoveryFile.safeParse(partial).success, field).toBe(false);
    }
  });

  test("rejects ports that are not valid TCP ports", () => {
    for (const port of [0, -1, 65536, 14900.5, "14900", Number.NaN]) {
      expect(DiscoveryFile.safeParse({ ...sample, port }).success, String(port)).toBe(false);
    }
  });

  test("rejects a pid or apiVersion that is not a positive integer", () => {
    for (const pid of [0, -5, 1.5, "48213"]) {
      expect(DiscoveryFile.safeParse({ ...sample, pid }).success, `pid ${String(pid)}`).toBe(false);
    }
    for (const apiVersion of [0, 1.5, "1"]) {
      expect(DiscoveryFile.safeParse({ ...sample, apiVersion }).success, `apiVersion ${String(apiVersion)}`).toBe(
        false,
      );
    }
  });

  test("ignores unknown fields", () => {
    expect(DiscoveryFile.parse({ ...sample, startedAt: "2026-11-04T09:00:00.000Z" })).toMatchObject(sample);
  });

  test("rejects a token that is empty or not a string", () => {
    for (const token of ["", null, 12345, { value: "x" }]) {
      expect(DiscoveryFile.safeParse({ ...sample, token }).success, JSON.stringify(token)).toBe(false);
    }
  });

  test("rejects input that is not an object", () => {
    for (const bad of [null, undefined, "service.json", 14900, []]) {
      expect(DiscoveryFile.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
