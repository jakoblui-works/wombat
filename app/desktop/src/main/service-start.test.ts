// Starting and stopping the service from the app. Every test runs in a temp sandbox (test/service-sandbox.ts)
// with the fake service, never the real runtime dir or service.
import { isAlive } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { startService, stopService } from "./service-start.ts";
import { FAKE_SERVICE_ENTRY, inProcessService, serviceSandbox } from "../../test/service-sandbox.ts";

test("a start that finds another service holding the lock takes the running one: one service serves every workspace", async () => {
  const sandbox = serviceSandbox();
  const running = await inProcessService(sandbox);
  // As a start that finds the lock held: it exits 0 and leaves the other service running.
  await expect(startService({ env: sandbox.env, entry: sandbox.exitingEntry() })).resolves.toEqual(running);
});

test("stopService resolves only once the service's process has exited, not at its 202", async () => {
  const sandbox = serviceSandbox();
  // The fake lives on after its 202, as a real service does while it closes its store.
  const env = { ...sandbox.env, FAKE_EXIT_DELAY_MS: "500" };
  const file = await startService({ env, entry: FAKE_SERVICE_ENTRY });
  expect(isAlive(file.pid)).toBe(true);
  await stopService(file);
  expect(isAlive(file.pid), "stopService returned while the service still ran").toBe(false);
});
