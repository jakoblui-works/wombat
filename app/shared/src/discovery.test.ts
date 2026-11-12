// The discovery file: how the app finds the running service, and the rule it trusts one by ("only the token proves it").
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { DiscoveryFile, findRunningService } from "./discovery.ts";
import { API_VERSION } from "./index.ts";

const WAIT_MS = 8_000;

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

  test("takes a file with or without the service's workspace", () => {
    expect(DiscoveryFile.parse(sample)).not.toHaveProperty("workspace");
    expect(DiscoveryFile.parse({ ...sample, workspace: "/home/dev/bakery" }).workspace).toBe("/home/dev/bakery");
  });
});

/** A stand-in for a running service: answers GET /version with 200 only to `Bearer <token>`, else 401. */
const versionServer = async (token: string): Promise<number> => {
  const server = createServer((req, res) => {
    const ok = req.method === "GET" && req.url === "/version" && req.headers.authorization === `Bearer ${token}`;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { apiVersion: API_VERSION } : { error: { code: "unauthorized", message: "no" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
};

test("findRunningService finds the file's service when it answers /version with the file's token, and not otherwise", async () => {
  const token = "live-token-0123456789abcdef";
  const port = await versionServer(token);
  const dir = mkdtempSync(join(tmpdir(), "wombat-discovery-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "service.json");

  expect(await findRunningService(path, { timeoutMs: WAIT_MS }), "no file").toBeUndefined();

  writeFileSync(path, JSON.stringify({ ...sample, port, token, pid: 4242 }));
  expect(await findRunningService(path, { timeoutMs: WAIT_MS })).toMatchObject({ port, pid: 4242 });

  // Same port, but the service there doesn't take this file's token: not the file's service.
  writeFileSync(path, JSON.stringify({ ...sample, port, token: "stale-token-0123456789abcdef", pid: 4242 }));
  expect(await findRunningService(path, { timeoutMs: WAIT_MS })).toBeUndefined();
});
