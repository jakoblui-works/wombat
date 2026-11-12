// A stop waits for the service's process to exit, and goes by the process the discovery file names (its start time):
// once its pid belongs to another process, the service has exited, and the stop doesn't wait for that other process.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, onTestFinished, test } from "vitest";

import { stopService } from "./service-start.ts";

const TOKEN = "stop-exit-token-0123456789";

test("a stop whose service's pid was taken by another process ends once the service answers, not after the exit wait", async () => {
  // Answers POST /shutdown as the service does once its agents are stopped.
  const server = createServer((req, res) => {
    const ok = req.method === "POST" && req.url === "/shutdown" && req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(ok ? 202 : 401, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  // This test's own pid stands for the reused one: alive, but started at another time than the file records.
  const file: DiscoveryFile = {
    apiVersion: API_VERSION,
    port: (server.address() as AddressInfo).port,
    pid: process.pid,
    token: TOKEN,
    processStart: `${startTimeOf(process.pid) ?? ""}0`,
  };

  await expect(stopService(file)).resolves.toBeUndefined();
}, 5_000);
