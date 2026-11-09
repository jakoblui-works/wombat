// The discovery file is how the app finds the service. What the service writes must parse with the shared schema
// the app reads it with, or the app can't find a running service. The file holds the bearer token, so its modes are
// a silent invariant: no other local user may read it.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_VERSION } from "@wombat/shared";
import { DiscoveryFile } from "@wombat/shared/discovery";
import { expect, onTestFinished, test } from "vitest";

import { findRunningService, newToken, removeDiscovery, writeDiscovery } from "./discovery.ts";

const WAIT_MS = 8_000;

/** A fresh `<tmp>/wombat/service.json` path; its folder doesn't exist yet. */
const tempPath = () => {
  const base = mkdtempSync(join(tmpdir(), "wombat-discovery-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return { dir: join(base, "wombat"), path: join(base, "wombat", "service.json") };
};

const sample = (overrides: Partial<DiscoveryFile> = {}): DiscoveryFile => ({
  apiVersion: API_VERSION,
  port: 14900,
  pid: process.pid,
  token: "test-token-0123456789abcdef",
  ...overrides,
});

const mode = (path: string) => statSync(path).mode & 0o777;

/** A stand-in for a running service: answers GET /version with 200 only to `Bearer <token>`, else 401. */
const versionServer = async (token: string): Promise<{ server: Server; port: number }> => {
  const server = createServer((req, res) => {
    const ok = req.method === "GET" && req.url === "/version" && req.headers.authorization === `Bearer ${token}`;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { apiVersion: API_VERSION } : { error: { code: "unauthorized", message: "no" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { server, port: (server.address() as AddressInfo).port };
};

test("discovery-file drift: what writeDiscovery writes parses with the shared DiscoveryFile schema and keeps its values", () => {
  const { path } = tempPath();
  const file = sample({ port: 15123, pid: 4242 });
  writeDiscovery(path, file);
  expect(DiscoveryFile.parse(JSON.parse(readFileSync(path, "utf8")))).toEqual(file);
});

test.each([
  { what: "into a new folder", existing: false },
  { what: "over a looser existing folder and file", existing: true },
])("writeDiscovery $what leaves the folder 0700 and the file 0600, with only the new file in it", ({ existing }) => {
  const { dir, path } = tempPath();
  if (existing) {
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    writeFileSync(path, JSON.stringify(sample({ pid: 1, token: "old-token-0123456789abcdef" })));
    chmodSync(path, 0o644);
  }
  const file = sample({ token: "new-token-0123456789abcdef" });
  writeDiscovery(path, file);
  expect(mode(dir).toString(8)).toBe("700");
  expect(mode(path).toString(8)).toBe("600");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(file);
  expect(readdirSync(dir), "temp files left beside the discovery file").toEqual(["service.json"]);
});

test("removeDiscovery removes the file only when it names this pid, and is fine when it's gone", () => {
  const { dir, path } = tempPath();
  mkdirSync(dir);
  const text = JSON.stringify(sample({ pid: 4242 }));
  writeFileSync(path, text);

  // Another instance's file (it replaced ours as stale): left alone.
  removeDiscovery(path, 4243);
  expect(readFileSync(path, "utf8")).toBe(text);

  removeDiscovery(path, 4242);
  expect(existsSync(path)).toBe(false);
  expect(() => removeDiscovery(path, 4242)).not.toThrow();
});

test("findRunningService finds the file's service when it answers /version with the file's token, and not otherwise", async () => {
  const token = "live-token-0123456789abcdef";
  const { port } = await versionServer(token);
  const { dir, path } = tempPath();
  mkdirSync(dir);

  writeFileSync(path, JSON.stringify(sample({ port, token, pid: 4242 })));
  expect(await findRunningService(path, { timeoutMs: WAIT_MS })).toMatchObject({ port, pid: 4242 });

  // Same port, but the service there doesn't take this file's token: not the file's service.
  writeFileSync(path, JSON.stringify(sample({ port, token: "stale-token-0123456789abcdef", pid: 4242 })));
  expect(await findRunningService(path, { timeoutMs: WAIT_MS })).toBeUndefined();
});

test("newToken gives at least 16 bearer-token characters, different on every call", () => {
  const tokens = Array.from({ length: 20 }, () => newToken());
  for (const token of tokens) {
    expect(token.length).toBeGreaterThanOrEqual(16);
    // RFC 6750 b64token: safe in an Authorization header as is.
    expect(token).toMatch(/^[A-Za-z0-9\-._~+/]+=*$/);
  }
  expect(new Set(tokens).size).toBe(tokens.length);
});
