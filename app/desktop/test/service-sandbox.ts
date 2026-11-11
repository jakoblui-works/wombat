// Temp runtime, state and home folders for the main process's service tests, so nothing reaches the real discovery
// file, lock or log; every fake service a test started is killed after it.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";

import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";

import { isRunning } from "../src/main/service-start.ts";

/** The fake service's entry (see fake-service.ts). */
export const FAKE_SERVICE_ENTRY = path.join(import.meta.dirname, "fake-service.ts");

export type Start = { pid: number; workspace: string; items: string | null };

export const serviceSandbox = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "wombat-main-")));
  const record = path.join(base, "starts.jsonl");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: path.join(base, "home"),
    XDG_RUNTIME_DIR: path.join(base, "run"),
    XDG_STATE_HOME: path.join(base, "state"),
    FAKE_SERVICE_RECORD: record,
  };
  const starts = (): Start[] =>
    existsSync(record)
      ? readFileSync(record, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as Start)
      : [];
  onTestFinished(() => {
    for (const { pid } of starts()) if (isRunning(pid)) process.kill(pid, "SIGKILL");
    rmSync(base, { recursive: true, force: true });
  });
  return {
    base,
    env,
    starts,
    discoveryPath: path.join(base, "run", "wombat", "service.json"),
    settingsFile: path.join(base, "config", "Wombat", "settings.json"),
    /** An absolute workspace path (the fake service doesn't need it to exist). */
    workspace: (name: string) => path.join(base, "workspaces", name),
    /** A script for `node` that exits 0 at once, as a start that finds the lock held does. */
    exitingEntry: () => {
      const entry = path.join(base, "exits-at-once.mjs");
      writeFileSync(entry, "process.exit(0);\n");
      return entry;
    },
  };
};

export type ServiceSandbox = ReturnType<typeof serviceSandbox>;

/**
 * A service in this process that answers GET /version to its token, with a discovery file naming `workspace` (none
 * when undefined); it's never stopped, so only tests that keep it running use it.
 */
export const inProcessService = async (sandbox: ServiceSandbox, workspace: string | undefined): Promise<DiscoveryFile> => {
  const token = "in-process-token-0123456789";
  const server = createServer((req, res) => {
    const ok = req.method === "GET" && req.url === "/version" && req.headers.authorization === `Bearer ${token}`;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify({ apiVersion: API_VERSION }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const file: DiscoveryFile = {
    apiVersion: API_VERSION,
    port: (server.address() as AddressInfo).port,
    pid: process.pid,
    token,
    ...(workspace === undefined ? {} : { workspace }),
  };
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(file));
  return file;
};
