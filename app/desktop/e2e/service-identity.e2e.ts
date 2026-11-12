// Contract "Service identity" through the running app: a service whose code is not what's on disk is reported stale
// on the bridge's connection state, and Restart replaces it with one running the code on disk. The code differs in a
// copy of the app inside the sandbox (app-copy.ts), never in the real checkout.
import { appCopy } from "./app-copy.ts";
import { connectedService, connectionsSeen, expect, isAlive, SWITCH, test, waitUntil, WAIT_MS } from "./app-fixtures.ts";

test("a service whose code changed on disk after it started is reported stale; Restart runs the code on disk and it no longer is", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const copy = appCopy(sandbox);
  const beforeStart = Date.now();
  const old = await sandbox.startService(sandbox.workspace, {}, copy.entry);
  const afterStart = Date.now();
  copy.changeServiceCode();

  // The app starts (and hashes) its service from the copy. Restart's stop question, if it asks, is answered Stop.
  const launched = await sandbox.launch({ env: { [SWITCH.serviceEntry]: copy.entry, [SWITCH.stopAnswer]: "stop" } });
  const stale = await connectedService(launched.page);
  expect(stale.service.stale, "a service started before its code changed isn't reported stale").toBe(true);
  const startedAt = Date.parse(stale.service.startedAt ?? "");
  expect(startedAt, "the service's startedAt isn't a time").not.toBeNaN();
  expect(startedAt, "startedAt isn't when the service started").toBeGreaterThanOrEqual(beforeStart - 1);
  expect(startedAt, "startedAt isn't when the service started").toBeLessThanOrEqual(afterStart);

  const seenBefore = (await connectionsSeen(launched.page)).length;
  await launched.page.evaluate(() => (window as unknown as { wombat: { service: { restart: () => Promise<void> } } }).wombat.service.restart());
  await waitUntil("the stale service to stop", WAIT_MS, () => (isAlive(old.pid) ? undefined : true));
  const fresh = await sandbox.waitForService((file) => file.pid !== old.pid);
  const after = await connectedService(launched.page, { after: seenBefore });
  expect(after.service.stale, "the service Restart started from the code on disk is still reported stale").toBe(false);
  expect(Date.parse(after.service.startedAt ?? ""), "the restarted service's startedAt isn't after the old one's").toBeGreaterThan(startedAt);
  expect(sandbox.liveServices(), "more than the restarted service runs").toEqual([fresh.pid]);
});

// Main hashes the code on disk again while connected (every STALE_CHECK_MS; the e2e switch makes it short), so a
// service that goes stale mid-session shows it without a reconnect or a relaunch.
const STALE_CHECK_MS = 300;

test("code that changes on disk while the app is connected marks the service stale without a reconnect; Restart clears it", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const copy = appCopy(sandbox);
  const launched = await sandbox.launch({
    env: { [SWITCH.serviceEntry]: copy.entry, [SWITCH.stopAnswer]: "stop", [SWITCH.staleCheckMs]: String(STALE_CHECK_MS) },
  });
  const fresh = await connectedService(launched.page);
  expect(fresh.service.stale, "the app's own service, just started from the code on disk, is reported stale").toBe(false);
  const old = await sandbox.waitForService();

  const seenBefore = (await connectionsSeen(launched.page)).length;
  copy.changeServiceCode();
  const states = await waitUntil("the connected service to be reported stale", WAIT_MS, async () => {
    const seen = (await connectionsSeen(launched.page)).slice(seenBefore);
    return seen.at(-1)?.service?.stale === true ? seen : undefined;
  });
  expect(states.map(({ state }) => state), "the stale mark came with a reconnect").toEqual(states.map(() => "connected"));
  expect(isAlive(old.pid), "the service was replaced, not marked").toBe(true);

  const seenAtRestart = (await connectionsSeen(launched.page)).length;
  await launched.page.evaluate(() => (window as unknown as { wombat: { service: { restart: () => Promise<void> } } }).wombat.service.restart());
  await waitUntil("the stale service to stop", WAIT_MS, () => (isAlive(old.pid) ? undefined : true));
  await sandbox.waitForService((file) => file.pid !== old.pid);
  const after = await connectedService(launched.page, { after: seenAtRestart });
  expect(after.service.stale, "the service Restart started from the changed code is still reported stale").toBe(false);
});
