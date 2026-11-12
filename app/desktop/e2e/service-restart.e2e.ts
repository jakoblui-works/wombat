// A Restart that fails is reported by main (reportError, a dialog in the real app), whatever the connection state, as
// the menu's Stop is: the page may be showing anything by then, and a failure nobody sees leaves the old service
// running. Under the e2e switches reportError writes to main's console instead of opening a dialog. The stop fails
// because the discovery file names a port nothing listens on while the service's process lives on (its port gone).
import { writeFileSync } from "node:fs";

import { expect, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

test("a Restart whose stop fails is reported by main, naming the service's pid", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const launched = await sandbox.launch({ env: { [SWITCH.stopAnswer]: "stop" } });
  await waitForConnection(launched.page, "connected");
  const file = await sandbox.waitForService();
  const errors: string[] = [];
  launched.app.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  writeFileSync(sandbox.discoveryPath, JSON.stringify({ ...sandbox.discovery(), port: await sandbox.freePort(file.port) }), { mode: 0o600 });
  const restarted = await launched.page.evaluate(() =>
    (window as unknown as { wombat: { service: { restart: () => Promise<void> } } }).wombat.service.restart().then(
      () => "resolved",
      (error: unknown) => `rejected: ${String(error)}`,
    ),
  );

  // Electron's own log line for a bridge handler that threw is not a report to the user.
  const reported = await waitUntil("main to report the failed Restart", WAIT_MS, () =>
    errors.find((line) => line.includes(`pid ${String(file.pid)}`) && !line.includes("Error occurred in handler")),
  ).catch(() => undefined);
  expect(reported, `the failed Restart (${restarted}) wasn't reported; main's console errors: ${JSON.stringify(errors)}`).toBeDefined();
});
