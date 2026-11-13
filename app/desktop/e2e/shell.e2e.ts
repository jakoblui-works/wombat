// The workbench shell, against the built app. Every launch runs in its own sandbox (app-fixtures.ts).
// What these checks rely on in the page (roles and names, not looks):
// - the activity bar: `navigation` "Activities", one button per activity named by its title with `aria-pressed`, and
//   the right sidebar's toggle (anywhere on the page, the design puts it in the title bar), a button named after what
//   it shows, starting "Needs me" (a count may follow), with `aria-pressed` (true while the sidebar is open);
// - the left sidebar: a `complementary` landmark named by the active activity's title; the right sidebar: a
//   `complementary` landmark "Needs me";
// - the resize handles: `separator`s "Resize the left sidebar" / "Resize the right sidebar";
// - the connection indicator: `data-testid="connection-indicator"` with an `aria-label` saying the state;
// - the disconnected banner: `role="alert"` or `role="status"`, holding a button "Restart".
// A remount of the editor would restore the start-up layout, so tabs are opened after launch and the tab's own DOM
// node is tagged: the same node, not just the same tabs, must still be there.
import type { Locator, Page } from "@playwright/test";
import {
  click,
  connectionStates,
  expect,
  isAlive,
  type LaunchedApp,
  layoutOf,
  openAgent,
  type Sandbox,
  startAgent,
  SWITCH,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
} from "./app-fixtures.ts";

const RIGHT_TOGGLE = /^Needs me\b/;

/** Tags the first element `selector` finds, so a later check can tell it's the same node. */
const tag = async (page: Page, mark: string, selector: string): Promise<void> => {
  const tagged = await page.evaluate(
    ([m, s]) => {
      const element = document.querySelector<HTMLElement>(s);
      if (element === null) return false;
      element.dataset["e2eMark"] = m;
      return true;
    },
    [mark, selector] as const,
  );
  expect(tagged, `nothing to tag at ${selector}`).toBe(true);
};

/** Whether the tagged node is still in the document, and whether it sits under an `inert` element. */
const tagged = (page: Page, mark: string): Promise<{ attached: boolean; inert: boolean }> =>
  page.evaluate((m) => {
    const element = document.querySelector<HTMLElement>(`[data-e2e-mark="${m}"]`);
    return { attached: element?.isConnected === true, inert: element?.closest("[inert]") != null };
  }, mark);

const activityBar = (page: Page): Locator => page.getByRole("navigation", { name: "Activities" });

/** The activity buttons' names, in the bar's order (every pressable button but the right-sidebar toggle). */
const activityNames = async (page: Page): Promise<string[]> => {
  const names: string[] = [];
  for (const button of await activityBar(page).getByRole("button").all()) {
    const name = (await button.getAttribute("aria-label")) ?? (await button.getAttribute("title")) ?? (await button.innerText());
    if ((await button.getAttribute("aria-pressed")) !== null && !RIGHT_TOGGLE.test(name.trim())) names.push(name.trim());
  }
  return names;
};

const indicator = (page: Page): Locator => page.getByTestId("connection-indicator");
const banner = (page: Page): Locator =>
  page.locator('[role="alert"], [role="status"]').filter({ has: page.getByRole("button", { name: "Restart", exact: true }) });

/** One fake agent in a service the test started, the app connected to it, and the agent's chat opened after launch. */
const appWithOpenChat = async (sandbox: Sandbox): Promise<{ launched: LaunchedApp; agentId: string }> => {
  await sandbox.startService(sandbox.workspace);
  const agentId = await startAgent(sandbox, "fake-reply");
  const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(launched.page, "connected");
  await openAgent(launched, agentId, 1);
  await tag(launched.page, "chat-tab", ".dv-tab");
  return { launched, agentId };
};

test.describe("workbench shell", () => {

  test("disconnected: the views stay, with their data, inert under a banner; Restart brings the service back and the same tabs", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const { launched } = await appWithOpenChat(sandbox);
    const { page } = launched;
    const [activity] = await activityNames(page);
    await tag(page, "sidebar", `aside[aria-label="${activity}"] > *`);
    const editor = await layoutOf(page);
    await expect(indicator(page)).toBeVisible();
    const connectedLabel = await indicator(page).getAttribute("aria-label");
    expect(connectedLabel, "the connection indicator has no aria-label").toBeTruthy();
    await expect(banner(page), "a banner while connected").toHaveCount(0);

    const first = await sandbox.waitForService();
    process.kill(first.pid, "SIGKILL");
    await waitUntil("the old service to be gone", WAIT_MS, () => (isAlive(first.pid) ? undefined : true));
    await waitUntil("the page to see the service gone", WAIT_MS, async () =>
      (await connectionStates(page)).some((state) => state === "reconnecting" || state === "failed") ? true : undefined,
    );
    const downAt = (await connectionStates(page)).length;

    await expect(banner(page), "no banner with a Restart button while disconnected").toBeVisible({ timeout: WAIT_MS });
    await expect(indicator(page), "the connection indicator still says connected").not.toHaveAttribute("aria-label", connectedLabel ?? "");
    for (const mark of ["chat-tab", "sidebar"]) {
      expect(await tagged(page, mark), `${mark}: replaced, or not inert, while disconnected`).toEqual({ attached: true, inert: true });
    }
    expect(await layoutOf(page), "the editor changed while disconnected").toEqual(editor);
    expect(await banner(page).evaluate((element) => element.closest("[inert]") != null), "the banner is inert").toBe(false);

    await click(banner(page).getByRole("button", { name: "Restart", exact: true }));
    await waitForConnection(page, "connected", { after: downAt });
    const second = await sandbox.waitForService();
    expect(second.pid, "Restart didn't start a new service").not.toBe(first.pid);
    await expect(banner(page), "the banner stayed after Restart connected").toHaveCount(0, { timeout: WAIT_MS });
    await expect(indicator(page)).toHaveAttribute("aria-label", connectedLabel ?? "");
    expect(await tagged(page, "chat-tab"), "the chat tab was replaced, or stays inert, after Restart").toEqual({ attached: true, inert: false });
    expect(await layoutOf(page), "the editor changed across the restart").toEqual(editor);
  });
});
