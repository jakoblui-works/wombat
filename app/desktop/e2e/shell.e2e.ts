// T11: the workbench shell, against the built app. Every launch runs in its own sandbox (app-fixtures.ts).
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

/** The right sidebar's name, and its toggle's: named after what they show (label in name), the toggle maybe with a count. */
const RIGHT_SIDEBAR = "Needs me";
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

const leftSidebar = (page: Page, activity: string): Locator => page.getByRole("complementary", { name: activity, exact: true });
const rightSidebar = (page: Page): Locator => page.getByRole("complementary", { name: RIGHT_SIDEBAR, exact: true });
const rightToggle = (page: Page): Locator => page.getByRole("button", { name: RIGHT_TOGGLE });
const indicator = (page: Page): Locator => page.getByTestId("connection-indicator");
const banner = (page: Page): Locator =>
  page.locator('[role="alert"], [role="status"]').filter({ has: page.getByRole("button", { name: "Restart", exact: true }) });

const widthOf = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(box, "the sidebar has no size").not.toBeNull();
  return Math.round(box?.width ?? 0);
};

/** Drags a resize handle sideways by `dx` pixels, as the user would with the mouse. */
const dragHandle = async (page: Page, name: string, dx: number): Promise<void> => {
  const box = await page.getByRole("separator", { name, exact: true }).boundingBox();
  expect(box, `the handle "${name}" has no size`).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
};

type SavedChrome = { sidebars?: { left?: number; right?: number; rightCollapsed?: boolean }; activity?: string };

const savedChrome = (sandbox: Sandbox): SavedChrome | undefined =>
  (sandbox.readSettings()?.["workspaces"] as Record<string, { layout?: SavedChrome }> | undefined)?.[sandbox.workspace]?.layout;

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

test.describe("T11: workbench shell", () => {
  test("switching activity changes only the left sidebar: the editor's tabs stay, the same ones, and the right sidebar is untouched", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const { launched } = await appWithOpenChat(sandbox);
    const { page } = launched;
    await rightToggle(page).click();
    await expect(rightToggle(page)).toHaveAttribute("aria-pressed", "true");
    const rightWidth = await widthOf(rightSidebar(page));
    const editor = await layoutOf(page);

    const names = await activityNames(page);
    expect(names.length, "the activity bar shows no activities").toBeGreaterThan(1);
    // Every other activity, then back to the first.
    for (const name of [...names.slice(1), names[0] as string]) {
      await activityBar(page).getByRole("button", { name, exact: true }).click();
      for (const other of names) {
        await expect(activityBar(page).getByRole("button", { name: other, exact: true }), `${other} marked while ${name} is active`).toHaveAttribute(
          "aria-pressed",
          other === name ? "true" : "false",
        );
      }
      await expect(leftSidebar(page, name), `the left sidebar doesn't show ${name}`).toBeVisible();
      expect(await tagged(page, "chat-tab"), `switching to ${name} replaced the editor's tab`).toMatchObject({ attached: true });
      expect(await layoutOf(page), `switching to ${name} changed the editor`).toEqual(editor);
      await expect(rightToggle(page)).toHaveAttribute("aria-pressed", "true");
      expect(await widthOf(rightSidebar(page)), `switching to ${name} changed the right sidebar`).toBe(rightWidth);
    }
  });

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

    await banner(page).getByRole("button", { name: "Restart", exact: true }).click();
    await waitForConnection(page, "connected", { after: downAt });
    const second = await sandbox.waitForService();
    expect(second.pid, "Restart didn't start a new service").not.toBe(first.pid);
    await expect(banner(page), "the banner stayed after Restart connected").toHaveCount(0, { timeout: WAIT_MS });
    await expect(indicator(page)).toHaveAttribute("aria-label", connectedLabel ?? "");
    expect(await tagged(page, "chat-tab"), "the chat tab was replaced, or stays inert, after Restart").toEqual({ attached: true, inert: false });
    expect(await layoutOf(page), "the editor changed across the restart").toEqual(editor);
  });

  test("the sidebars the user set (widths, right sidebar open, activity) are saved and come back after a restart", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const env = { [SWITCH.quitAnswer]: "leave" };
    await sandbox.startService(sandbox.workspace);
    const first = await sandbox.launch({ env });
    await waitForConnection(first.page, "connected");
    const names = await activityNames(first.page);
    const chosen = names[1];
    expect(chosen, "fewer than two activities").toBeDefined();

    await rightToggle(first.page).click();
    await waitUntil("the open right sidebar in settings.json", WAIT_MS, () => (savedChrome(sandbox)?.sidebars?.rightCollapsed === false ? true : undefined));
    const before = savedChrome(sandbox);
    await activityBar(first.page).getByRole("button", { name: chosen as string, exact: true }).click();
    await waitUntil("the activity in settings.json", WAIT_MS, () => (savedChrome(sandbox)?.activity !== before?.activity ? true : undefined));

    // Resized last, so nothing after it saves the widths on its behalf.
    const left = await widthOf(leftSidebar(first.page, chosen as string));
    const right = await widthOf(rightSidebar(first.page));
    await dragHandle(first.page, "Resize the left sidebar", 60);
    await dragHandle(first.page, "Resize the right sidebar", -60);
    const leftAfter = await widthOf(leftSidebar(first.page, chosen as string));
    const rightAfter = await widthOf(rightSidebar(first.page));
    expect(leftAfter, "dragging the left handle right didn't widen the left sidebar").toBeGreaterThan(left);
    expect(rightAfter, "dragging the right handle left didn't widen the right sidebar").toBeGreaterThan(right);
    // The widths on screen, not just any change: a save made mid-drag would pass a weaker wait, and the last one,
    // still pending at quit, is dropped by design (no save during unload).
    await waitUntil("the widths on screen in settings.json", WAIT_MS, () => {
      const now = savedChrome(sandbox)?.sidebars;
      return now?.left === leftAfter && now.right === rightAfter ? true : undefined;
    });
    await first.quit();
    await first.exited();

    const second = await sandbox.launch({ env, workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    await expect(activityBar(second.page).getByRole("button", { name: chosen as string, exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: WAIT_MS });
    await expect(rightToggle(second.page)).toHaveAttribute("aria-pressed", "true");
    expect(await widthOf(leftSidebar(second.page, chosen as string)), "the left sidebar's width").toBe(leftAfter);
    expect(await widthOf(rightSidebar(second.page)), "the right sidebar's width").toBe(rightAfter);
  });
});
