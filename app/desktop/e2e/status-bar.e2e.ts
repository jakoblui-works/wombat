// What the page shows of the running service, so nobody runs an old service for hours without knowing: a service left
// running from before the app is announced once at launch, and a stale one is called older than the app in the notice
// and the status bar; a service the app starts itself is neither. Layout, colours and the panel are the screenshots' to
// show.
import { appCopy } from "./app-copy.ts";
import { connectedService, expect, SWITCH, test, WAIT_MS } from "./app-fixtures.ts";

const NOTICE_SINCE = /Connected to the agent service that has been running since/;
const OLDER_CODE_NOTICE = /runs older code than the app/;
const STALE_ITEM = /older than the app/;

test("a stale service left running before the app started is announced at launch, and the status bar calls it older than the app", async ({ sandbox }) => {
  test.setTimeout(60_000);
  const copy = appCopy(sandbox);
  await sandbox.startService(sandbox.workspace, {}, copy.entry);
  copy.changeServiceCode();

  const { page } = await sandbox.launch({ env: { [SWITCH.serviceEntry]: copy.entry } });
  const connected = await connectedService(page);
  expect(connected.service.foundAtLaunch, "a service running before the app isn't marked as found at launch").toBe(true);
  const notice = page.getByText(NOTICE_SINCE);
  await expect(notice, "no launch notice for a service that was running before the app").toBeVisible({ timeout: WAIT_MS });
  await expect(page.getByText(OLDER_CODE_NOTICE).first(), "the launch notice doesn't say the service runs older code").toBeVisible();
  await expect(page.getByText(STALE_ITEM).first(), "the status bar doesn't call the service older than the app").toBeVisible();
});
