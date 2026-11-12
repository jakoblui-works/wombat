// The connected service's info on the connection state: when it started and whether it runs the code on disk, read
// from GET /version once connected and again every staleCheckMs. Each test runs a small service in this process that
// answers /version as given.
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";
import { expect, onTestFinished, test, vi } from "vitest";

import { serviceSandbox } from "../../test/service-sandbox.ts";
import type { ConnectionState } from "../shared/bridge.ts";
import { serviceConnection } from "./service-connection.ts";

const TOKEN = "identity-service-token-0123456789";
const ON_DISK = "0123456789abcdef";
const STARTED_AT = "2026-11-12T07:34:00.000Z";

/** A service whose /version answers each try with the next of `versions` (the last one repeated), and opens /events. */
const serveVersions = async (versions: { status: number; body: unknown }[], onDisk: () => string = () => ON_DISK, staleCheckMs = 60_000) => {
  const sandbox = serviceSandbox();
  const sockets = new Set<Socket>();
  let tries = 0;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
    } else if (req.url === "/version") {
      const answer = versions[Math.min(tries, versions.length - 1)] ?? { status: 500, body: {} };
      tries += 1;
      res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    } else if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
    } else {
      res.writeHead(404).end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  const file: DiscoveryFile = { apiVersion: API_VERSION, port: (server.address() as AddressInfo).port, pid: process.pid, token: TOKEN };
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(file));

  const states: ConnectionState[] = [];
  const logged: string[] = [];
  const connection = serviceConnection({
    discoveryFile: () => sandbox.discoveryPath,
    onState: ({ state }) => states.push(state),
    onAlert: () => undefined,
    codeIdOnDisk: onDisk,
    timing: { staleCheckMs },
    log: (line) => logged.push(line),
  });
  onTestFinished(() => connection.close());
  await connection.reconnect(() => Promise.resolve());
  return { states, logged };
};

test("connected to a service on other code: the state says when it started, and that it's stale", async () => {
  const { states } = await serveVersions([{ status: 200, body: { apiVersion: API_VERSION, startedAt: STARTED_AT, codeId: "fedcba9876543210" } }]);
  await vi.waitFor(() => {
    expect(states.at(-1)).toEqual({ state: "connected", service: { startedAt: STARTED_AT, stale: true } });
  });
});

test("when /version fails once connected, the state stays connected, without the service's info", async () => {
  // The first answer is the probe's, which finds the service; the second, once connected, fails.
  const { states, logged } = await serveVersions([
    { status: 200, body: { apiVersion: API_VERSION } },
    { status: 500, body: { error: "broken" } },
  ]);
  await vi.waitFor(() => {
    expect(logged.join("\n")).toMatch(/couldn't read which code the service runs: HTTP 500/);
  });
  expect(states.at(-1)).toEqual({ state: "connected" });
  expect(states.some((state) => state.service !== undefined)).toBe(false);
});

test("code that changes on disk while connected marks the service stale at the next check, with no reconnect", async () => {
  let onDisk = ON_DISK;
  const { states } = await serveVersions(
    [{ status: 200, body: { apiVersion: API_VERSION, startedAt: STARTED_AT, codeId: ON_DISK } }],
    () => onDisk,
    20,
  );
  await vi.waitFor(() => {
    expect(states.at(-1)?.service).toEqual({ startedAt: STARTED_AT, stale: false });
  });
  const before = states.length;

  onDisk = "fedcba9876543210";
  await vi.waitFor(() => {
    expect(states.at(-1)?.service?.stale).toBe(true);
  });
  expect(states.slice(before)).toEqual([{ state: "connected", service: { startedAt: STARTED_AT, stale: true } }]);
});
