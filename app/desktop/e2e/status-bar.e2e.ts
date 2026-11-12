// What the page shows of the running service, so nobody runs an old service for hours without knowing: a service left
// running from before the app is announced once at launch, and a stale one is called older than the app in the notice
// and the status bar; a service the app starts itself is neither. Layout, colours and the panel are the screenshots' to
// show.
import { appCopy } from "./app-copy.ts";
import { connectedService, expect, SWITCH, test, WAIT_MS } from "./app-fixtures.ts";

const LAUNCH_NOTICE = /Connected to the agent service that has been running since/;
const OLDER_CODE_NOTICE = /runs older code than the app/;
// "Service · running 6 h 15 min · 1 agent"; not "Service · not running".
const SERVICE_RUNNING = /Service\W+running/;
const STALE_ITEM = /older than the app/;

test("a stale service left running before the app started is announced at launch, and the status bar calls it older than the app", async ({ sandbox }) => {
  test.setTimeout(60_000);
  const copy = appCopy(sandbox);
  await sandbox.startService(sandbox.workspace, {}, copy.entry);
  copy.changeServiceCode();

  const { page } = await sandbox.launch({ env: { [SWITCH.serviceEntry]: copy.entry } });
  await connectedService(page);
  const notice = page.getByText(LAUNCH_NOTICE);
  await expect(notice, "no launch notice for a service that was running before the app").toBeVisible({ timeout: WAIT_MS });
  await expect(page.getByText(OLDER_CODE_NOTICE).first(), "the launch notice doesn't say the service runs older code").toBeVisible();
  await expect(page.getByText(STALE_ITEM).first(), "the status bar doesn't call the service older than the app").toBeVisible();
});

test("a service the app started itself shows as running in the status bar, without a launch notice and not as older than the app", async ({ sandbox }) => {
  test.setTimeout(60_000);
  const { page } = await sandbox.launch();
  const connected = await connectedService(page);
  expect(connected.service.stale, "the app's own service, from the code on disk, is reported stale").toBe(false);
  await expect(page.getByText(SERVICE_RUNNING).first(), "the status bar doesn't show the service running").toBeVisible({ timeout: WAIT_MS });
  // The notice would show on this first connection, which the status bar already reflects.
  await expect(page.getByText(LAUNCH_NOTICE)).toHaveCount(0);
  await expect(page.getByText(STALE_ITEM)).toHaveCount(0);
});
