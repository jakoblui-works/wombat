// Starting and stopping the service from the app. Every test runs in a temp sandbox (test/service-sandbox.ts)
// with the fake service, never the real runtime dir or service.
import { isAlive } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { ServiceStartFailed, startService, stopService } from "./service-start.ts";
import { FAKE_SERVICE_ENTRY, inProcessService, serviceSandbox } from "../../test/service-sandbox.ts";

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
