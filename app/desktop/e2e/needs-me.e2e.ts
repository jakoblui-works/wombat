// S7 T15: Needs me, against the built app and the fake-permission agent (asks "Edit notes.txt" and waits).
// What this check relies on in the page (roles and names; S6's selector contract plus T15's rows):
// - the toggle: a `button` whose name starts with "Needs me", followed by the count while it's above 0;
// - the right sidebar `complementary` "Needs me" lists one `button` per row, naming what the agent asks; empty, it
//   says "Nothing needs you";
// - a revealed permission is scrolled into view and holds the focus (its card, or an element inside it, is focused);
//   its answer buttons are "Approve" and "Reject" (as in the chat).
import type { Locator, Page } from "@playwright/test";

import { expect, layoutOf, REPO, sendOpenAgent, startWaitingAgent, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";
import { groupWithTab } from "./agent-views.ts";

const toggle = (page: Page): Locator => page.getByRole("button", { name: /^Needs me\b/ });
const needsMe = (page: Page): Locator => page.getByRole("complementary", { name: "Needs me", exact: true });
const activity = (page: Page, name: string): Locator => page.getByRole("navigation", { name: "Activities" }).getByRole("button", { name, exact: true });

/**
 * Whether the focus is on the open permission: on its card (the closest section, region or group around its Approve
 * button) or inside it. An ancestor of the card (the chat, the tab) doesn't count.
 */
const focusOnPermission = (approve: Locator): Promise<boolean> =>
  approve.evaluate((button) => {
    const active = document.activeElement;
    const card = button.closest('section, [role="region"], [role="group"]');
    return active !== null && card !== null && card.contains(active);
  });

test.describe("T15: Needs me", () => {
  test("a waiting agent shows up; a click opens its chat at the request (again on a second click, and for a notification); answering clears the row", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startWaitingAgent(sandbox, "Update the notes.");
    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page, app } = launched;
    await waitForConnection(page, "connected");

    // The count, then the row: what the agent asks.
    await expect(toggle(page)).toHaveAccessibleName(/^Needs me\s*1$/, { timeout: WAIT_MS });
    if ((await toggle(page).getAttribute("aria-pressed")) !== "true") await toggle(page).click();
    const row = needsMe(page).getByRole("button", { name: /Edit notes\.txt/ });
    await expect(row).toHaveCount(1);

    // A click: Agents, the agent's chat, the request in view and focused.
    await activity(page, "Files").click();
    await row.click();
    await expect(activity(page, "Agents")).toHaveAttribute("aria-pressed", "true");
    await waitUntil("the agent's chat tab", WAIT_MS, async () => ((await layoutOf(page)).some((group) => group.tabs.includes(REPO)) ? true : undefined));
    const approve = groupWithTab(page, REPO).getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeInViewport({ timeout: WAIT_MS });
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);

    // The focus elsewhere, a second click on the same row: the request is revealed again, in the same tab.
    await toggle(page).focus();
    expect(await focusOnPermission(approve)).toBe(false);
    await row.click();
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);
    expect((await layoutOf(page)).flatMap((group) => group.tabs)).toEqual([REPO]);

    // A notification click (main's open-agent event, no request id) takes the same path: its oldest pending request.
    await activity(page, "Files").click();
    await toggle(page).focus();
    await sendOpenAgent(app, agentId);
    await expect(activity(page, "Agents")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);
    expect((await layoutOf(page)).flatMap((group) => group.tabs)).toEqual([REPO]);

    // Answering clears the row and the count.
    await approve.click();
    await expect(row).toHaveCount(0, { timeout: WAIT_MS });
    await expect(needsMe(page).getByText("Nothing needs you")).toBeVisible();
    await expect(toggle(page)).not.toHaveAccessibleName(/^Needs me\s*[1-9]/);
  });
});
