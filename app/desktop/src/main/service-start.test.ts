// Starting and stopping the service from the app. Every test runs in a temp sandbox (test/service-sandbox.ts)
// with the fake service, never the real runtime dir or service.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { isAlive } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { ServiceStartFailed, serviceLogPath, startService, stopService } from "./service-start.ts";
import { FAKE_SERVICE_ENTRY, inProcessService, serviceSandbox } from "../../test/service-sandbox.ts";

test("a start that never writes a discovery file fails after the timeout, naming the service's log", async () => {
  const sandbox = serviceSandbox();
  // A stand-in service that records its start, then only waits.
  const entry = path.join(sandbox.base, "silent-service.mjs");
  writeFileSync(
    entry,
    `import { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_SERVICE_RECORD, JSON.stringify({ pid: process.pid }) + "\\n");\nsetTimeout(() => {}, 10_000);\n`,
  );

  const start = startService({ env: sandbox.env, entry, workspace: sandbox.workspace("main"), timeoutMs: 300 });
  await expect(start).rejects.toBeInstanceOf(ServiceStartFailed);
  await expect(start).rejects.toThrow(serviceLogPath(sandbox.env));
  expect(serviceLogPath(sandbox.env)).toBe(path.join(sandbox.base, "state", "wombat", "service.log"));
});

test("a start with a missing entry fails before spawning, naming the entry", async () => {
  const sandbox = serviceSandbox();
  const entry = path.join(sandbox.base, "no-such-entry.ts");
  await expect(startService({ env: sandbox.env, entry, workspace: sandbox.workspace("main") })).rejects.toThrow(entry);
});

test("a start that finds a service for another workspace fails naming both, instead of taking it", async () => {
  const sandbox = serviceSandbox();
  const other = sandbox.workspace("other");
  const wanted = sandbox.workspace("main");
  await inProcessService(sandbox, other);
  // As a start that finds the lock held: it exits 0 and leaves the other service running.
  const start = startService({ env: sandbox.env, entry: sandbox.exitingEntry(), workspace: wanted });
  await expect(start).rejects.toBeInstanceOf(ServiceStartFailed);
  await expect(start).rejects.toThrow(other);
  await expect(start).rejects.toThrow(wanted);
});

test("the service gets the settings' items root, never one inherited from the app's env", async () => {
  const sandbox = serviceSandbox();
  const env = { ...sandbox.env, WOMBAT_ITEMS: "/inherited/items" };
  const first = await startService({ env, entry: FAKE_SERVICE_ENTRY, workspace: sandbox.workspace("main") });
  await stopService(first);
  await startService({ env, entry: FAKE_SERVICE_ENTRY, workspace: sandbox.workspace("main"), itemsRoot: "/settings/items" });
  expect(sandbox.starts().map(({ items }) => items)).toEqual([null, "/settings/items"]);
});

test("stopService resolves only once the service's process has exited, not at its 202", async () => {
  const sandbox = serviceSandbox();
  // The fake lives on after its 202, as a real service does while it closes its store.
  const env = { ...sandbox.env, FAKE_EXIT_DELAY_MS: "500" };
  const file = await startService({ env, entry: FAKE_SERVICE_ENTRY, workspace: sandbox.workspace("main") });
  expect(isAlive(file.pid)).toBe(true);
  await stopService(file);
  expect(isAlive(file.pid), "stopService returned while the service still ran").toBe(false);
});
