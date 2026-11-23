// Needs me, against the built app and the fake-permission agent (asks "Edit notes.txt" and waits).
// What this check relies on in the page (roles and names):
// - the left sidebar is the `complementary` "Agents"; Needs me is the part of it holding the heading "Needs me" (and not
//   the overview's heading "Agents"), its header reading "Needs me" then the count;
// - Needs me lists one `button` per row, naming what the agent asks; empty, it says "Nothing needs you";
// - the middle (`main`) shows the open agent's chat, its `h2` the agent's folder;
// - a revealed permission is scrolled into view and holds the focus (its card, or an element inside it, is focused);
//   its answer buttons are "Approve" and "Reject" (as in the chat).
import type { Locator, Page } from "@playwright/test";

import { click, expect, REPO, sendOpenAgent, startWaitingAgent, SWITCH, test, waitForConnection, WAIT_MS } from "./app-fixtures.ts";
import { chatTitled } from "./agent-panels.ts";

const left = (page: Page): Locator => page.getByRole("complementary", { name: "Agents", exact: true });
const needsMe = (page: Page): Locator =>
  left(page)
    .locator("*")
    .filter({ has: page.getByRole("heading", { name: "Needs me", exact: true }) })
    .filter({ hasNot: page.getByRole("heading", { name: "Agents", exact: true }) })
    .first();

/**
 * Whether the focus is on the open permission: on its card (the closest section, region or group around its Approve
 * button) or inside it. An ancestor of the card (the chat) doesn't count.
 */
const focusOnPermission = (approve: Locator): Promise<boolean> =>
  approve.evaluate((button) => {
    const active = document.activeElement;
    const card = button.closest('section, [role="region"], [role="group"]');
    return active !== null && card !== null && card.contains(active);
  });

test.describe("Needs me", () => {
  test("a waiting agent shows up; a click opens its chat at the request (again on a second click, and for a notification); answering clears the row", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startWaitingAgent(sandbox, "Update the notes.");
    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page, app } = launched;
    await waitForConnection(page, "connected");

    // The count, then the row: what the agent asks.
    await expect(needsMe(page)).toHaveText(/^\s*Needs me\s*1(?!\d)/, { timeout: WAIT_MS });
    const row = needsMe(page).getByRole("button", { name: /Edit notes\.txt/ });
    await expect(row).toHaveCount(1);

    // A click: the agent's chat in the middle, the request in view and focused.
    await click(row);
    const approve = chatTitled(page, REPO).getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeInViewport({ timeout: WAIT_MS });
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);

    // The focus elsewhere, a second click on the same row: the request is revealed again, in the same chat.
    await row.focus();
    expect(await focusOnPermission(approve)).toBe(false);
    await click(row);
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([REPO]);

    // A notification click (main's open-agent event, no request id) takes the same path: its oldest pending request.
    await row.focus();
    await sendOpenAgent(app, agentId);
    await expect.poll(() => focusOnPermission(approve), { timeout: WAIT_MS }).toBe(true);
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([REPO]);

    // Answering clears the row and the count.
    await click(approve);
    await expect(row).toHaveCount(0, { timeout: WAIT_MS });
    await expect(needsMe(page).getByText("Nothing needs you")).toBeVisible();
    await expect(needsMe(page)).not.toHaveText(/^\s*Needs me\s*[1-9]/);
  });
});
