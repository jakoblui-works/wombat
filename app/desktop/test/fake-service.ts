// A stand-in for the agent service that `node` runs in the main process's unit tests: it writes a discovery file for
// WOMBAT_WORKSPACE, answers GET /version to its token, and on POST /shutdown removes the file, answers 202 and
// exits FAKE_EXIT_DELAY_MS later (a real service still closes its store then). Each start appends
// `{ pid, workspace, items }` to FAKE_SERVICE_RECORD, so a test can tell which services ran and kill them after.
//
//   FAKE_START_DELAY_MS  how long it waits before listening and writing the discovery file
//   FAKE_EXIT_DELAY_MS   how long it lives on after answering POST /shutdown
import { randomBytes } from "node:crypto";
import { appendFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { API_VERSION } from "@wombat/shared";
import { discoveryPath, readDiscovery } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";

const { env } = process;
const file = discoveryPath(env);
const token = randomBytes(16).toString("hex");
const record = env["FAKE_SERVICE_RECORD"];
if (record !== undefined) {
  appendFileSync(record, `${JSON.stringify({ pid: process.pid, workspace: env["WOMBAT_WORKSPACE"], items: env["WOMBAT_ITEMS"] ?? null })}\n`);
}
// Never outlives a test that forgot it.
setTimeout(() => process.exit(0), 60_000).unref();

const server = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
  } else if (req.method === "GET" && req.url === "/version") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ apiVersion: API_VERSION }));
  } else if (req.method === "POST" && req.url === "/shutdown") {
    if (readDiscovery(file)?.pid === process.pid) rmSync(file, { force: true });
    res.writeHead(202).end(() => setTimeout(() => process.exit(0), Number(env["FAKE_EXIT_DELAY_MS"] ?? "0")));
  } else {
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => setTimeout(resolve, Number(env["FAKE_START_DELAY_MS"] ?? "0")));
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  writePrivateFile(file, JSON.stringify({ apiVersion: API_VERSION, port, pid: process.pid, token, workspace: env["WOMBAT_WORKSPACE"] }));
});
