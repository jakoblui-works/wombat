// The page's requests as main sends them: refused before the network unless they fit the allow-list and the
// service's body cap. The service is a counting server in this process.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, onTestFinished, test } from "vitest";

import type { DiscoveryFile } from "@wombat/shared/discovery";

import { RequestRefused, requestService } from "./service-client.ts";

const countingService = async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method ?? ""} ${req.url ?? ""}`);
    req.resume();
    req.once("end", () => res.writeHead(202, { "content-type": "application/json" }).end("{}"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const file: DiscoveryFile = { apiVersion: 1, port: (server.address() as AddressInfo).port, pid: process.pid, token: "counting-token-0123456789" };
  return { file, seen };
};

test("a route outside the allow-list is refused in main and never sent", async () => {
  const { file, seen } = await countingService();
  await expect(requestService(file, "POST", "/shutdown", undefined)).rejects.toBeInstanceOf(RequestRefused);
  await expect(requestService(file, 42, {}, undefined)).rejects.toBeInstanceOf(RequestRefused);
  expect(seen).toEqual([]);
});
