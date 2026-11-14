// Proposals from an agent to the user's decision, against the built app and the `fake-call-tool` agent (it calls the
// MCP tool its prompt names; see service/test/app-e2e-entry.ts). With no request waiting, the agent proposes edits to
// two files; Approve on one row writes it, the other row opens its tab, and Reject there with a reason leaves it.
// What this relies on in the page:
// - the title bar toggle: a `button` whose name starts with "Needs me"; the right sidebar `complementary` "Needs me";
// - one row per open proposal holding its file's path, with an open `button` holding the path and the buttons
//   "Approve" and "Reject"; a click on the open button opens the proposal in an editor tab (dockview's
//   `.dv-content-container`), which has "Reject", and then a `textbox` named with "reason", sent with Enter.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

import { agentSummary, click, expect, REPO, type Sandbox, startAgent, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

type Listed = { id: string; status: string; path?: string; rejectReason?: string };

const needsMe = (page: Page): Locator => page.getByRole("complementary", { name: "Needs me", exact: true });

/** The innermost element in Needs me holding `file` and a Reject button: the proposal's row. */
const rowOf = (page: Page, file: string): Locator =>
  needsMe(page).locator("*").filter({ hasText: file }).filter({ has: page.getByRole("button", { name: "Reject", exact: true }) }).last();

const listed = async (sandbox: Sandbox): Promise<Listed[]> => {
  const read = await sandbox.api("GET", "/proposals");
  expect(read.status, `GET /proposals: ${JSON.stringify(read.json)}`).toBe(200);
  return (read.json as { proposals: Listed[] }).proposals;
};

const proposalOn = async (sandbox: Sandbox, file: string): Promise<Listed | undefined> => (await listed(sandbox)).find((p) => p.path === file);

/** Has the agent propose `edits` to `file` and waits until the service lists the proposal. */
const propose = async (sandbox: Sandbox, agentId: string, file: string, edits: { old: string; new: string }[]): Promise<void> => {
  await waitUntil(`agent ${agentId} between turns`, WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "working" ? undefined : true));
  const sent = await sandbox.api("POST", `/agents/${agentId}/messages`, {
    text: JSON.stringify({ tool: "propose_change", arguments: { path: file, reason: "The bakery's hours changed.", edits } }),
  });
  expect(sent.status, `prompt: ${JSON.stringify(sent.json)}`).toBe(202);
  await waitUntil(`a proposal on ${file}`, WAIT_MS, async () => ((await proposalOn(sandbox, file)) === undefined ? undefined : true));
};

test("an agent's proposals: Approve on a row writes the file, a row opens its tab, Reject there with a reason leaves the file", async ({ sandbox }) => {
  await sandbox.startService(sandbox.workspace);
  const hours = path.join(sandbox.workspace, REPO, "opening-hours.md");
  const prices = path.join(sandbox.workspace, REPO, "prices.md");
  const hoursBefore = "# Opening hours\n\nSaturday: 8:00 to 14:00\n";
  const pricesBefore = "# Prices\n\nRye loaf: 5.80\n";
  writeFileSync(hours, hoursBefore);
  writeFileSync(prices, pricesBefore);

  const agentId = await startAgent(sandbox, "fake-call-tool");
  await propose(sandbox, agentId, hours, [{ old: "Saturday: 8:00", new: "Saturday: 7:30" }]);
  await propose(sandbox, agentId, prices, [{ old: "Rye loaf: 5.80", new: "Rye loaf: 6.10" }]);

  const { page } = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(page, "connected");
  const toggle = page.getByRole("button", { name: /^Needs me\b/ });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await click(toggle);

  // No request waits: both proposals still show.
  await expect(rowOf(page, hours)).toBeVisible({ timeout: WAIT_MS });
  await expect(rowOf(page, prices)).toBeVisible({ timeout: WAIT_MS });

  // Approve on a row: the file is written and the row goes.
  await click(rowOf(page, hours).getByRole("button", { name: "Approve", exact: true }));
  await waitUntil("the approved edit on disk", WAIT_MS, () => (readFileSync(hours, "utf8") === hoursBefore.replace("8:00", "7:30") ? true : undefined));
  await expect(needsMe(page).getByText(hours)).toHaveCount(0, { timeout: WAIT_MS });

  // The other row opens its tab; Reject there with a reason.
  await click(needsMe(page).getByRole("button").filter({ hasText: prices }));
  const tab = page.locator(".dv-groupview .dv-content-container").filter({ hasText: prices });
  await click(tab.getByRole("button", { name: "Reject", exact: true }));
  const reason = "Prices stay until the new menu is printed.";
  await tab.getByRole("textbox", { name: /reason/i }).fill(reason);
  await tab.getByRole("textbox", { name: /reason/i }).press("Enter");
  await waitUntil("the prices proposal rejected", WAIT_MS, async () => ((await proposalOn(sandbox, prices))?.status === "rejected" ? true : undefined));

  expect((await proposalOn(sandbox, prices))?.rejectReason).toBe(reason);
  expect(readFileSync(prices, "utf8")).toBe(pricesBefore);
  await expect(needsMe(page).getByText(prices)).toHaveCount(0, { timeout: WAIT_MS });
});
