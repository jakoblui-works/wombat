// S7 T12: the Agents sidebar and New agent, against the built app and the fake agents (app-fixtures.ts).
// What this check relies on in the page (roles and names, not looks; the approved design's structure):
// - the left sidebar `complementary` "Agents" (S6) holds a button "New agent";
// - New agent opens a `dialog` with a folder pick (a `combobox` named "Folder" whose `option`s are the folders by
//   name), one `textbox` for the first message, and a button "Start";
// - the agent list groups rows in `region`s named by the group's label (AGENT_STATES' labels: "Done", …); a row's
//   main part is a button naming the agent (its title, else its repo), and beside it a button "Agent actions" opens
//   a `menu` with the `menuitem`s "Stop" (while it runs) and "Delete";
// - Delete asks in an `alertdialog` with the buttons "Cancel" (focused when it opens) and "Delete".
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { AGENT_STATES } from "../src/renderer/src/lib/agent-state.ts";
import { click, expect, layoutOf, REPO, type Sandbox, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

const agentsSidebar = (page: Page) => page.getByRole("complementary", { name: "Agents", exact: true });

/** The ids of the agents the service lists. */
const agentIds = async (sandbox: Sandbox): Promise<string[]> => {
  const listed = await sandbox.api("GET", "/agents");
  return (listed.json as { agents: { id: string }[] }).agents.map(({ id }) => id);
};

test.describe("Agents sidebar and New agent", () => {
  test("start an agent from New agent, see it done, open its chat, delete it (Enter on the confirmation cancels)", async ({ sandbox }) => {
    test.setTimeout(90_000);
    // REPO as a git repo, so GET /repos offers it beside the workspace root.
    mkdirSync(path.join(sandbox.workspace, REPO, ".git"), { recursive: true });
    await sandbox.startService(sandbox.workspace);
    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page } = launched;
    await waitForConnection(page, "connected");
    const sidebar = agentsSidebar(page);

    // Start: the folder pick lists the root and REPO (from the service, through main's allow-list); pick REPO.
    await click(sidebar.getByRole("button", { name: "New agent", exact: true }).first());
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await click(dialog.getByRole("combobox", { name: "Folder" }));
    await expect(page.getByRole("option", { name: path.basename(sandbox.workspace), exact: true })).toBeVisible();
    await click(page.getByRole("option", { name: REPO, exact: true }));
    await dialog.getByRole("textbox").fill("Say hello to the bakery.");
    await click(dialog.getByRole("button", { name: "Start", exact: true }));
    await expect(dialog).toBeHidden();

    // One agent, started in REPO with the first harness; the folder is remembered for next time.
    const [agentId] = await waitUntil("the started agent", WAIT_MS, async () => {
      const ids = await agentIds(sandbox);
      return ids.length === 1 ? ids : undefined;
    });
    const listed = (await sandbox.api("GET", "/agents")).json as { agents: { id: string; repo: string; harness: string }[] };
    expect(listed.agents[0]?.repo).toBe(REPO);
    await waitUntil("lastAgentFolder in settings.json", WAIT_MS, () => (sandbox.readSettings()?.["lastAgentFolder"] === REPO ? true : undefined));

    // The start opened its chat; the agent's row ends in the Done group.
    const done = sidebar.getByRole("region", { name: AGENT_STATES.done.label, exact: true });
    const row = done.getByRole("button", { name: new RegExp(REPO) }).first();
    await expect(row).toBeVisible({ timeout: WAIT_MS });
    await expect(page.locator(".dv-groupview").getByText("Hello from the fake agent.")).toBeVisible({ timeout: WAIT_MS });

    // Open its chat from the row (after closing it): the one tab, named after the agent.
    while ((await page.locator(".dv-tab").count()) > 0) await page.locator(".dv-tab .dv-default-tab-action").first().click({ force: true });
    await expect(page.locator(".dv-tab")).toHaveCount(0);
    await click(row);
    await expect(page.locator(".dv-tab")).toHaveCount(1);
    expect((await layoutOf(page)).flatMap((group) => group.tabs)).toEqual([REPO]);
    await expect(page.locator(".dv-groupview").getByText("Hello from the fake agent.")).toBeVisible();

    // Delete: Enter on the confirmation is Cancel; the agent stays.
    await click(done.getByRole("button", { name: "Agent actions" }).first());
    await click(page.getByRole("menuitem", { name: "Delete", exact: true }));
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();
    expect(await agentIds(sandbox)).toEqual([agentId]);
    await expect(row).toBeVisible();

    // Confirmed: the agent, its row and its tab go.
    await click(done.getByRole("button", { name: "Agent actions" }).first());
    await click(page.getByRole("menuitem", { name: "Delete", exact: true }));
    await click(page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }));
    await waitUntil("the agent deleted in the service", WAIT_MS, async () => ((await agentIds(sandbox)).length === 0 ? true : undefined));
    await expect(sidebar.getByRole("button", { name: new RegExp(REPO) })).toHaveCount(0);
    await expect(page.locator(".dv-tab")).toHaveCount(0);
    await expect(sidebar.getByText("No agents yet")).toBeVisible();
  });
});
