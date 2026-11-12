// Lasting check "A page unload stops layout saves", against the built app: once the page has seen
// `beforeunload`, the Workbench's layout saver writes nothing more, whatever the user changes. A workspace switch
// reloads the page after main has moved on, so a save from then on would write the old workspace's layout under the
// new one. The page can't be rendered outside Electron (the desktop's unit tests run without a DOM), so this is the
// cheapest layer that sees the Workbench's own wiring of the event to the saver.
//
// Absence is shown against the app's own timing: the control change measures how long a save takes to land here, and
// after the unload the check watches for several times that long.
import type { Page } from "@playwright/test";
import { expect, type Sandbox, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

/** How many times the control save's latency the check watches for a save after the unload. */
const ABSENCE_FACTOR = 5;

const savedActivity = (sandbox: Sandbox): unknown =>
  (
    (sandbox.readSettings()?.["workspaces"] as Record<string, { layout?: { activity?: unknown } }> | undefined)?.[sandbox.workspace]
      ?.layout
  )?.activity;

const activityButton = (page: Page, title: string) => page.locator(`nav[aria-label="Activities"] button[aria-label="${title}"]`);

/** Clicks an activity in the activity bar, as the user would, and waits until the page shows it as the active one. */
const selectActivity = async (page: Page, title: string): Promise<void> => {
  await activityButton(page, title).click();
  await expect(activityButton(page, title)).toHaveAttribute("aria-pressed", "true");
};

test.describe("check: a page unload stops layout saves", () => {
  test("after beforeunload, a change the user makes isn't saved within several times a save's latency", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const launched = await sandbox.launch();
    const { page } = launched;
    await waitForConnection(page, "connected");

    // Control: saving works, and how long a user change takes to reach settings.json.
    // shell.e2e.ts's saved-sidebars test relies on this control to check that an activity change saves on its own.
    const startedAt = Date.now();
    await selectActivity(page, "Files");
    await waitUntil("the Files activity in the saved layout", WAIT_MS, () => (savedActivity(sandbox) === "files" ? true : undefined));
    const saveLatencyMs = Date.now() - startedAt;

    // The page starts unloading (as on a workspace switch's reload); then the user changes the layout.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
    await selectActivity(page, "Workspace");

    const watchUntil = Date.now() + ABSENCE_FACTOR * saveLatencyMs;
    while (Date.now() < watchUntil) {
      expect(savedActivity(sandbox), "a layout save landed after beforeunload").toBe("files");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(savedActivity(sandbox), "a layout save landed after beforeunload").toBe("files");
  });
});
