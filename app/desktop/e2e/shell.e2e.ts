// The workbench shell, against the built app. Every launch runs in its own sandbox (app-fixtures.ts).
// What these checks rely on in the page (roles and names, not looks):
// - the left sidebar: an `aside` "Agents"; the chat: a `log` "Conversation" in `main`;
// - the right sidebar's strip: a `tablist` of `tab`s, outside `main`; an edit request in the chat is a `region`
//   "Edit approval" with a button "Open side by side" that opens its diff tab there;
// - the connection indicator: `data-testid="connection-indicator"` with an `aria-label` saying the state;
// - the disconnected banner: `role="alert"` or `role="status"`, holding a button "Restart".
// A remount of the panels would restore the start-up state, so the chat and a tab are opened after launch and their
// own DOM nodes are tagged: the same nodes, not just the same chat and tabs, must still be there.
import type { Locator, Page } from "@playwright/test";
import {
  click,
  connectionStates,
  expect,
  isAlive,
  type LaunchedApp,
  openAgent,
  type Sandbox,
  startWaitingAgent,
  SWITCH,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
} from "./app-fixtures.ts";

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

const strip = (page: Page): Locator => page.getByRole("tablist");

/** The open tabs' titles in the visible strip, and the chat's heading in `main`; by element, as inert ones leave the accessibility tree. */
const shownPanels = async (page: Page): Promise<{ tabs: string[]; chat: string[] }> => ({
  tabs: (await page.locator('[role="tablist"]:visible [role="tab"]').allInnerTexts()).map((title) => title.trim()),
  chat: (await page.locator("main h2").allInnerTexts()).map((title) => title.trim()),
});

const indicator = (page: Page): Locator => page.getByTestId("connection-indicator");
const banner = (page: Page): Locator =>
  page.locator('[role="alert"], [role="status"]').filter({ has: page.getByRole("button", { name: "Restart", exact: true }) });

/**
 * One fake agent waiting on an edit in a service the test started, the app connected to it, and after launch the
 * agent's chat opened in `main` and its diff opened as a tab in the right strip.
 */
const appWithOpenChat = async (sandbox: Sandbox): Promise<{ launched: LaunchedApp; agentId: string }> => {
  await sandbox.startService(sandbox.workspace);
  const agentId = await startWaitingAgent(sandbox, "Update the notes.");
  const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  const { page } = launched;
  await waitForConnection(page, "connected");
  await openAgent(launched, agentId);
  const card = page.getByRole("main").getByRole("region", { name: "Edit approval" }).last();
  await click(card.getByRole("button", { name: "Open side by side" }));
  await expect(strip(page).getByRole("tab"), "Open side by side opened no tab in the right strip").toHaveCount(1, { timeout: WAIT_MS });
  await tag(page, "chat", 'main [role="log"]');
  await tag(page, "tab", '[role="tablist"] [role="tab"]');
  return { launched, agentId };
};

test.describe("workbench shell", () => {

  test("disconnected: the panels stay, with their data, inert under a banner; Restart brings the service back and the same tabs", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const { launched } = await appWithOpenChat(sandbox);
    const { page } = launched;
    await tag(page, "sidebar", 'aside[aria-label="Agents"] > *');
    const panels = await shownPanels(page);
    expect(panels.tabs, "no tab in the strip before the disconnect").toHaveLength(1);
    expect(panels.chat, "no chat in main before the disconnect").toHaveLength(1);
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
    for (const mark of ["chat", "tab", "sidebar"]) {
      expect(await tagged(page, mark), `${mark}: replaced, or not inert, while disconnected`).toEqual({ attached: true, inert: true });
    }
    expect(await shownPanels(page), "the chat or the tabs changed while disconnected").toEqual(panels);
    expect(await banner(page).evaluate((element) => element.closest("[inert]") != null), "the banner is inert").toBe(false);

    await click(banner(page).getByRole("button", { name: "Restart", exact: true }));
    await waitForConnection(page, "connected", { after: downAt });
    const second = await sandbox.waitForService();
    expect(second.pid, "Restart didn't start a new service").not.toBe(first.pid);
    await expect(banner(page), "the banner stayed after Restart connected").toHaveCount(0, { timeout: WAIT_MS });
    await expect(indicator(page)).toHaveAttribute("aria-label", connectedLabel ?? "");
    for (const mark of ["chat", "tab"]) {
      expect(await tagged(page, mark), `${mark}: replaced, or stays inert, after Restart`).toEqual({ attached: true, inert: false });
    }
    expect(await shownPanels(page), "the chat or the tabs changed across the restart").toEqual(panels);
  });
});
