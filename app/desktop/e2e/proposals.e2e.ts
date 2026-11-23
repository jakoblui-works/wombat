// Proposals from an agent to the user's decision, against the built app and the `fake-call-tool` agent (it calls the
// MCP tool its prompt names; see service/test/app-e2e-entry.ts). With no request waiting, the agent proposes edits to
// two files; each row opens its tab, Approve in one writes its file, and Reject in the other with a reason leaves it.
// What this relies on in the page:
// - Needs me: the part of the left sidebar (`complementary` "Agents") holding the heading "Needs me" and not the
//   overview's heading "Agents";
// - one row per open proposal: a `button` holding its file's path, without Approve or Reject; a click opens the
//   proposal in a tab, whose content is the one visible `tabpanel`, with "Approve" and "Reject", and after Reject a
//   `textbox` named with "reason", sent with Enter.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

import { agentSummary, click, expect, REPO, type Sandbox, startAgent, SWITCH, test, waitForConnection, waitUntil, WAIT_MS, wheelPastEnd, workspaceId } from "./app-fixtures.ts";
import { SETTINGS_FILE } from "../../service/src/items/binders.ts";

type Listed = { id: string; status: string; path?: string; rejectReason?: string };

const needsMe = (page: Page): Locator =>
  page
    .getByRole("complementary", { name: "Agents", exact: true })
    .locator("*")
    .filter({ has: page.getByRole("heading", { name: "Needs me", exact: true }) })
    .filter({ hasNot: page.getByRole("heading", { name: "Agents", exact: true }) })
    .first();

/** The proposal's row in Needs me: the one button holding `file`. */
const rowOf = (page: Page, file: string): Locator => needsMe(page).getByRole("button").filter({ hasText: file });

/** The open tab's content while it holds `text`. */
const tabHolding = (page: Page, text: string): Locator => page.getByRole("tabpanel").filter({ hasText: text });

// Content Security Policy violations the page reports, recorded from when `recordViolations` runs.
const VIOLATIONS = "__wombatE2eCspViolations";
const recordViolations = (page: Page): Promise<void> =>
  page.evaluate((key) => {
    const seen: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"} at ${event.sourceFile}:${String(event.lineNumber)}`);
    });
  }, VIOLATIONS);
const violations = (page: Page): Promise<string[]> =>
  page.evaluate((key) => [...((window as unknown as Record<string, string[] | undefined>)[key] ?? ["(recorder missing)"])], VIOLATIONS);

const listed = async (sandbox: Sandbox): Promise<Listed[]> => {
  const read = await sandbox.api("GET", "/proposals");
  expect(read.status, `GET /proposals: ${JSON.stringify(read.json)}`).toBe(200);
  return (read.json as { proposals: Listed[] }).proposals;
};

/** The path of item `ref` in the sandbox's workspace. */
const itemPath = async (sandbox: Sandbox, ref: string): Promise<string> => `/workspaces/${await workspaceId(sandbox)}/items/${ref}`;

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

test("an agent's proposals: each row opens its tab, Approve there writes the file, Reject there with a reason leaves the file", async ({ sandbox }) => {
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

  // No request waits: both proposals still show, without Approve or Reject on the rows.
  await expect(rowOf(page, hours)).toBeVisible({ timeout: WAIT_MS });
  await expect(rowOf(page, prices)).toBeVisible({ timeout: WAIT_MS });
  await expect(needsMe(page).getByRole("button", { name: /^(Approve|Reject)$/ })).toHaveCount(0);

  // A row opens its tab; Approve there: the file is written and the row goes.
  await click(rowOf(page, hours));
  await click(tabHolding(page, hours).getByRole("button", { name: "Approve", exact: true }));
  await waitUntil("the approved edit on disk", WAIT_MS, () => (readFileSync(hours, "utf8") === hoursBefore.replace("8:00", "7:30") ? true : undefined));
  await expect(needsMe(page).getByText(hours)).toHaveCount(0, { timeout: WAIT_MS });

  // The other row opens its tab; Reject there with a reason.
  await click(rowOf(page, prices));
  const tab = tabHolding(page, prices);
  await click(tab.getByRole("button", { name: "Reject", exact: true }));
  const reason = "Prices stay until the new menu is printed.";
  await tab.getByRole("textbox", { name: /reason/i }).fill(reason);
  await tab.getByRole("textbox", { name: /reason/i }).press("Enter");
  await waitUntil("the prices proposal rejected", WAIT_MS, async () => ((await proposalOn(sandbox, prices))?.status === "rejected" ? true : undefined));

  expect((await proposalOn(sandbox, prices))?.rejectReason).toBe(reason);
  expect(readFileSync(prices, "utf8")).toBe(pricesBefore);
  await expect(needsMe(page).getByText(prices)).toHaveCount(0, { timeout: WAIT_MS });
});

// Editing in a proposal's tab: the right side of its diff (Monaco's `.monaco-diff-editor .editor.modified`) takes
// typing, the text is saved as my draft, and Approve writes my text.
test("text typed on a proposal's right side is saved as my draft, and Approve writes it", async ({ sandbox }) => {
  await sandbox.startService(sandbox.workspace);
  const menu = path.join(sandbox.workspace, REPO, "menu.md");
  writeFileSync(menu, "# Menu\n\nRye loaf: 5.80\n\nBaguette: 2.10\n\nPretzel: 1.50\n");
  const agentId = await startAgent(sandbox, "fake-call-tool");
  await propose(sandbox, agentId, menu, [
    { old: "Rye loaf: 5.80", new: "Rye loaf: 6.10" },
    { old: "Pretzel: 1.50", new: "Pretzel: 1.70" },
  ]);
  const id = (await proposalOn(sandbox, menu))?.id ?? "";

  const { page } = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(page, "connected");
  await recordViolations(page);
  await click(rowOf(page, menu));
  const tab = tabHolding(page, menu);
  const right = tab.locator(".monaco-diff-editor .editor.modified");

  // Drop the agent's first hunk (Rye loaf) with Monaco's revert arrow in the gutter, one per hunk in line order.
  const rye = right.locator(".view-line").filter({ hasText: "Rye loaf: 6.10" });
  await expect(rye).toBeVisible({ timeout: WAIT_MS });
  await rye.hover();
  await click(tab.locator(".gutter .action-label.codicon-arrow-right").first());
  await expect(right.locator(".view-line").filter({ hasText: "Rye loaf: 5.80" })).toBeVisible({ timeout: WAIT_MS });

  // Click into the line "Baguette: 2.10" on the right, go to its end and type, as the user would; then Approve at
  // once, before the draft is saved on its own.
  const line = right.locator(".view-line").filter({ hasText: "Baguette: 2.10" });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (until noon)");
  await click(tab.getByRole("button", { name: "Approve", exact: true }));

  type Detail = { status: string };
  const read = async (): Promise<Detail> => (await sandbox.api("GET", `/proposals/${encodeURIComponent(id)}`)).json as Detail;
  await waitUntil("the proposal approved", WAIT_MS, async () => ((await read()).status === "approved" ? true : undefined));
  expect(readFileSync(menu, "utf8")).toBe("# Menu\n\nRye loaf: 5.80\n\nBaguette: 2.10 (until noon)\n\nPretzel: 1.70\n");
  // Monaco's editable diff (the gutter menu, the hover) under the CSP: every <style> it made carried the page's nonce.
  expect(await violations(page), "CSP violations with the editable diff").toEqual([]);
});

// An item proposal in its tab, on an items root (the workspace's items folder) with one `bugs` binder open to proposals: each
// field the proposal changes is a `group` named by the field, with a "Drop" button; Approve writes only the fields I kept.
// The proposal is of a second workspace, listed after the one shown at launch. Its row in Needs me shows that workspace
// (the title bar, `banner`, names the shown workspace), opens the item's tab (in the one visible `tablist`, named from
// its handle, selected) and reveals the item's row in the Desk sidebar (`complementary` "Desk", the row a `treeitem`
// named by the item's title inside the row's element): that element is highlighted (`data-revealed`) and holds the focus.
test("a Needs me click on an item update of a workspace not shown shows that workspace, opens the item and highlights its row in the Desk; dropping a field and approving writes only the fields I kept", async ({
  sandbox,
}) => {
  const bug = { id: "0196f3c2-1a00-7000-8000-00000000c001", handle: "BUG-1", title: "Basket total ignores the coupon" };
  const items = path.join(sandbox.base, "items");
  mkdirSync(path.join(items, "bugs"), { recursive: true });
  writeFileSync(
    path.join(items, "bugs", SETTINGS_FILE),
    "version: 1\nid: bugs\nname: Bugs\nprefix: BUG\naccess: propose\nproperties:\n  status: { type: select, options: [open, fixed], required: true }\n",
  );
  const file = path.join(items, "bugs", "basket-coupon.md");
  writeFileSync(file, `---\nid: ${bug.id}\nhandle: ${bug.handle}\nstatus: open\n---\n# ${bug.title}\n\nThe coupon shows but the total stays the same.\n`);
  await sandbox.startService(sandbox.workspace);
  await workspaceId(sandbox);
  const orchardName = "orchard";
  const orchard = sandbox.newWorkspace(orchardName);
  const added = await sandbox.api("POST", "/workspaces", { root: orchard, itemsRoot: items });
  expect(added.status, `adding ${orchardName}: ${JSON.stringify(added.json)}`).toBe(200);
  const orchardId = await workspaceId(sandbox, orchard);

  type ItemRead = { body: string | null; properties: Record<string, unknown>; version: string };
  const item = async (): Promise<ItemRead> => (await sandbox.api("GET", `/workspaces/${orchardId}/items/${bug.handle}`)).json as ItemRead;
  const newBody = "\nThe coupon shows but the total stays the same, only for coupons in percent.\n";
  const started = await sandbox.api("POST", "/agents", { workspace: orchardId, harness: "fake-call-tool", repo: REPO });
  expect(started.status, `start fake-call-tool in ${orchardName}: ${JSON.stringify(started.json)}`).toBe(201);
  const agentId = (started.json as { id: string }).id;
  await waitUntil(`agent ${agentId} between turns`, WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "working" ? undefined : true));
  const call = { tool: "propose_update", arguments: { handle: bug.handle, fields: { status: "fixed", body: newBody }, version: (await item()).version, reason: "Narrowed it down." } };
  expect((await sandbox.api("POST", `/agents/${agentId}/messages`, { text: JSON.stringify(call) })).status).toBe(202);
  const id = await waitUntil("the item proposal listed", WAIT_MS, async () => (await listed(sandbox))[0]?.id);

  const { page } = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(page, "connected");
  await expect(page.getByRole("banner"), "the workspace listed first isn't shown at launch").toContainText(path.basename(sandbox.workspace), { timeout: WAIT_MS });
  await expect(page.getByRole("banner"), `${orchardName} is shown at launch`).not.toContainText(orchardName);
  // An item proposal's row in Needs me shows its workspace, opens the item and the Desk on its binder; its mark there
  // opens the proposal's tab.
  await click(rowOf(page, `bugs/${bug.handle}`));
  await expect(page.getByRole("banner"), `the row didn't show ${orchardName}`).toContainText(orchardName, { timeout: WAIT_MS });
  const itemTab = page.getByRole("tablist").getByRole("tab", { name: new RegExp(`^\\s*${bug.handle}\\b`) });
  await expect(itemTab, "the item's tab isn't open and selected").toHaveAttribute("aria-selected", "true", { timeout: WAIT_MS });
  const revealed = page.getByRole("complementary", { name: "Desk" }).getByRole("treeitem", { name: bug.title, exact: true }).locator("..");
  await expect(revealed, "the item's row highlighted").toHaveAttribute("data-revealed", "", { timeout: WAIT_MS });
  await expect(revealed.locator(":focus"), "the focus in the item's row").toHaveCount(1);
  await click(page.getByRole("complementary", { name: "Desk" }).getByRole("button", { name: "Update proposed", exact: true }));
  const tab = tabHolding(page, `bugs/${bug.handle}`);
  await click(tab.getByRole("group", { name: "status", exact: true }).getByRole("button", { name: "Drop", exact: true }));

  type Detail = { status: string; fields: Record<string, unknown>; versions: { n: number; by: string }[] };
  const read = async (): Promise<Detail> => (await sandbox.api("GET", `/proposals/${encodeURIComponent(id)}`)).json as Detail;
  await waitUntil("my draft without the status saved", WAIT_MS, async () => {
    const { fields, versions } = await read();
    const current = versions.reduce((top, v) => (v.n > top.n ? v : top));
    return current.by === "me" && !Object.hasOwn(fields, "status") ? true : undefined;
  });
  await click(tab.getByRole("button", { name: "Approve", exact: true }));
  await waitUntil("the proposal approved", WAIT_MS, async () => ((await read()).status === "approved" ? true : undefined));

  const after = await item();
  expect(after.properties["status"], "the dropped status stays").toBe("open");
  expect(after.body?.trim(), "the kept body is written").toBe(newBody.trim());
});

// Item proposals decided where they show in the Desk's list (the binder's plain list: no views): a proposed create is a
// row (a `treeitem` named by its proposed title, its proposal lines beside it in the same parent), a proposed update
// marks its item's row with a button "Update proposed"; each row holds "Approve" and "Reject", and Reject there sends
// no reason.
test("in the Desk's list, Approve on a proposed create writes its item's file, and Reject on an update's marked row leaves the file and drops the mark", async ({ sandbox }) => {
  const items = path.join(sandbox.base, "items");
  const folder = path.join(items, "chores");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, SETTINGS_FILE),
    "version: 1\nid: chores\nname: Chores\nprefix: CH\naccess: propose\nproperties:\n  stage: { type: select, options: [todo, doing, done], required: true }\n",
  );
  const water = { title: "Water the tomatoes", file: path.join(folder, "CH-1.md") };
  const waterBytes = "---\nid: 0196f3c2-1b00-7000-8000-00000000c001\nhandle: CH-1\nstage: todo\n---\n# Water the tomatoes\n\nEvery other evening.\n";
  writeFileSync(water.file, waterBytes);
  await sandbox.startService(sandbox.workspace, { itemsRoot: items });

  const agentId = await startAgent(sandbox, "fake-call-tool");
  const proposeItem = async (tool: string, args: Record<string, unknown>): Promise<string> => {
    const before = new Set((await listed(sandbox)).map(({ id }) => id));
    await waitUntil(`agent ${agentId} between turns`, WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "working" ? undefined : true));
    expect((await sandbox.api("POST", `/agents/${agentId}/messages`, { text: JSON.stringify({ tool, arguments: args }) })).status).toBe(202);
    return waitUntil(`the ${tool} proposal listed`, WAIT_MS, async () => (await listed(sandbox)).find(({ id }) => !before.has(id))?.id);
  };
  const mulch = "Mulch the raspberry bed";
  const createId = await proposeItem("propose_create", { binder: "chores", title: mulch, reason: "The raspberries dried out.", properties: { stage: "doing" } });
  const version = ((await sandbox.api("GET", await itemPath(sandbox, "CH-1"))).json as { version: string }).version;
  const updateId = await proposeItem("propose_update", { handle: "CH-1", fields: { stage: "done" }, version, reason: "Watered this morning." });
  const statusOf = async (id: string): Promise<string | undefined> => (await listed(sandbox)).find((p) => p.id === id)?.status;

  const { page } = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(page, "connected");
  await recordViolations(page);
  const desk = page.getByRole("main").getByRole("button", { name: "Desk", exact: true });
  if ((await desk.getAttribute("aria-pressed")) !== "true") await click(desk);
  const side = page.getByRole("complementary", { name: "Desk", exact: true });
  await click(side.getByRole("treeitem", { name: /^Chores/ }));
  const rowOfTitle = (title: string): Locator => side.getByRole("treeitem", { name: title, exact: true }).locator("..");

  const before = new Set(readdirSync(folder));
  await click(rowOfTitle(mulch).getByRole("button", { name: "Approve", exact: true }));
  await waitUntil("the create approved", WAIT_MS, async () => ((await statusOf(createId)) === "approved" ? true : undefined));
  const created = readdirSync(folder).filter((name) => !before.has(name));
  expect(created, "one new file").toHaveLength(1);
  const text = readFileSync(path.join(folder, created[0] ?? ""), "utf8");
  expect(text, "the new file holds the proposed title").toContain(`# ${mulch}`);
  expect(text, "the new file holds the proposed stage").toMatch(/^stage: doing$/m);

  const waterRow = rowOfTitle(water.title);
  await expect(waterRow.getByRole("button", { name: "Update proposed", exact: true }), "the update's mark").toBeVisible({ timeout: WAIT_MS });
  await click(waterRow.getByRole("button", { name: "Reject", exact: true }));
  await waitUntil("the update rejected", WAIT_MS, async () => ((await statusOf(updateId)) === "rejected" ? true : undefined));
  await expect(waterRow.getByRole("button", { name: "Update proposed", exact: true }), "the mark gone").toHaveCount(0, { timeout: WAIT_MS });
  await expect(waterRow, "the row still shows").toBeVisible();
  expect(readFileSync(water.file, "utf8"), "the file byte for byte").toBe(waterBytes);
  expect(await violations(page), "CSP violations in the Desk").toEqual([]);
});

// The Desk's list owns its scroll (the sidebar's `complementary` "Desk", each row showing its item's title): a wheel past
// its end scrolls nothing around it.
test("a wheel past the end of the Desk's list scrolls nothing around it", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const items = path.join(sandbox.base, "items");
  const folder = path.join(items, "rota");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, SETTINGS_FILE), "version: 1\nid: rota\nname: Rota\nprefix: RO\naccess: propose\n");
  const titles = Array.from({ length: 30 }, (_, i) => `Review the alert rules of shard ${String(i + 1)}`);
  for (const [i, title] of titles.entries()) {
    const n = i + 1;
    writeFileSync(path.join(folder, `RO-${String(n)}.md`), `---\nid: 0196f3c2-1c00-7000-8000-${n.toString(16).padStart(12, "0")}\nhandle: RO-${String(n)}\n---\n# ${title}\n\nCheck the runbook first.\n`);
  }
  await sandbox.startService(sandbox.workspace, { itemsRoot: items });

  const { page } = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  await waitForConnection(page, "connected");
  const desk = page.getByRole("main").getByRole("button", { name: "Desk", exact: true });
  if ((await desk.getAttribute("aria-pressed")) !== "true") await click(desk);
  const side = page.getByRole("complementary", { name: "Desk", exact: true });
  await click(side.getByRole("treeitem", { name: /^Rota/ }));
  const titled = (title: string): Locator => side.getByText(title, { exact: true });
  await expect(titled(titles.at(-1) ?? ""), "the whole list loaded").toHaveCount(1, { timeout: WAIT_MS });

  expect(await wheelPastEnd(titled(titles[0] ?? ""), "down"), "scrolled or overflowing around the list").toEqual([]);
  expect(problems, "page errors").toEqual([]);
});
