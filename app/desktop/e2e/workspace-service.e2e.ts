// The workspace, the settings file and the service start, and two workspaces side by side, against the built app.
// Every launch runs in its own sandbox (app-fixtures.ts): temp profile, runtime and state dirs, fake systemd, fake
// agents.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { click, expect, isAlive, type Sandbox, startAgent, test, SWITCH, waitForConnection, waitUntil, WAIT_MS, workspaceId } from "./app-fixtures.ts";

const mode = (file: string): number => statSync(file).mode & 0o777;

test.describe("first start", () => {
  test("a fresh profile starts the service, adds the chosen folder as its first workspace, keeps its files private, and a second start reuses it", async ({ sandbox }) => {
    // A quit stops a service without agent processes (nothing left running unseen); one agent and the answer Keep
    // leave it running.
    const first = await sandbox.launch({ workspaceAnswer: sandbox.workspace, env: { [SWITCH.quitAnswer]: "leave" } });
    await waitForConnection(first.page, "connected");
    // The service lists the folder the picker answered; the discovery file names no workspace.
    const file = await sandbox.waitForService();
    expect(Object.keys(file), "the discovery file names a workspace").not.toContain("workspace");
    expect(sandbox.liveServices()).toEqual([file.pid]);
    await workspaceId(sandbox);
    // The settings file and the service's log: 0600, the settings in a 0700 folder. A page change writes the settings.
    await first.page.evaluate(() => (window as unknown as { wombat: { settings: { set: (patch: unknown) => Promise<void> } } }).wombat.settings.set({ askOnQuit: true }));
    const settings = sandbox.settingsPath();
    await waitUntil("settings.json to be written", WAIT_MS, () => (sandbox.readSettings()?.["version"] === 2 ? true : undefined));
    expect(mode(settings).toString(8), "settings.json isn't 0600").toBe("600");
    expect(mode(path.dirname(settings)).toString(8), "the settings folder isn't 0700").toBe("700");
    expect(mode(path.join(sandbox.stateDir, "wombat", "service.log")).toString(8), "service.log isn't 0600").toBe("600");

    await startAgent(sandbox, "fake-reply");
    await first.quit();
    await first.exited();
    expect(isAlive(file.pid), "closing the app stopped the service").toBe(true);

    // No workspace answer this time: the service already lists one, so the app asks nothing.
    const second = await sandbox.launch({ workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    expect(sandbox.discovery()?.pid, "the second start replaced the service").toBe(file.pid);
    expect(sandbox.serviceStarts(), "the second start spawned another service").toEqual([file.pid]);
  });
});

// The bridge's workspace.add(): the folder picker, then the folder added to the running service.
test.describe("Add a workspace", () => {
  test("workspace.add() adds the chosen folder to the running service and answers its id, without restarting the service or reloading the page", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const next = sandbox.newWorkspace("next");
    await sandbox.startService(sandbox.workspace);
    // The folder picker's answer (WOMBAT_E2E_WORKSPACE) is the one added.
    const { page } = await sandbox.launch({ workspaceAnswer: next });
    await waitForConnection(page, "connected");
    const before = await sandbox.waitForService();

    await page.evaluate(() => {
      (window as unknown as { __e2eBeforeAdd?: boolean }).__e2eBeforeAdd = true;
    });
    // workspace.add() runs only right after the user's input to the window.
    await page.keyboard.press("Shift");
    const id = await page.evaluate(() => (window as unknown as { wombat: { workspace: { add: () => Promise<string | undefined> } } }).wombat.workspace.add());

    expect(id, "workspace.add() didn't answer the listed workspace's id").toBe(await workspaceId(sandbox, next));
    expect(await workspaceId(sandbox), "the first workspace is no longer listed").toBeTruthy();
    expect(sandbox.discovery()?.pid, "the service was replaced").toBe(before.pid);
    expect(sandbox.serviceStarts(), "another service was started").toEqual([before.pid]);
    expect(await page.evaluate(() => (window as unknown as { __e2eBeforeAdd?: boolean }).__e2eBeforeAdd), "the page reloaded").toBe(true);
    expect(sandbox.readSettings()?.["workspace"], "settings.json names a folder").toBeUndefined();
  });
});

// Two workspaces, each with an items folder of its own and an agent; all names invented. What it relies on in the
// page: the left sidebar `complementary` "Agents" (a row is a button naming its folder); the chat's `log`
// "Conversation" in `main`, an item link in it a button named by the handle; the toolbar's `button` "Desk" in `main`;
// the shown workspace's tab strip is the one visible `tablist`, an item's tab named from its handle; the item's form
// field `textbox` "Title"; the navigator `complementary` "Desk", its binders `treeitem`s named from the binder's name.
const ORCHARD = { name: "orchard", repo: "cider-press", binder: { id: "chores", name: "Chores", prefix: "CH" } };
const ALLOTMENT = { name: "allotment", repo: "seed-catalogue", binder: { id: "seeds", name: "Seeds", prefix: "SD" } };
type Garden = typeof ORCHARD;

/** Garden `garden`'s folder (its repo a git repo) and items folder (one binder holding `<prefix>-1`); answers its id. */
const addGarden = async (sandbox: Sandbox, { name, repo, binder }: Garden, first: boolean): Promise<string> => {
  const root = sandbox.newWorkspace(name);
  mkdirSync(path.join(root, repo, ".git"), { recursive: true });
  const items = path.join(sandbox.base, `items-${name}`);
  mkdirSync(path.join(items, binder.id), { recursive: true });
  writeFileSync(path.join(items, binder.id, "_binder.yaml"), `version: 1\nid: ${binder.id}\nname: ${binder.name}\nprefix: ${binder.prefix}\naccess: edit\n`);
  const itemId = `0196f3c2-2a00-7000-8000-${first ? "00000000c201" : "00000000d201"}`;
  writeFileSync(path.join(items, binder.id, `${binder.prefix}-1.md`), `---\nid: ${itemId}\nhandle: ${binder.prefix}-1\n---\n# Invented for ${name}\n\nInvented.\n`);
  if (first) await sandbox.startService(root, { itemsRoot: items });
  else expect((await sandbox.api("POST", "/workspaces", { root, itemsRoot: items })).status, `adding ${name}`).toBe(200);
  return workspaceId(sandbox, root);
};

/** An agent in `repo` of workspace `ws` whose one message is `text`, done. */
const agentSaying = async (sandbox: Sandbox, ws: string, repo: string, text: string): Promise<void> => {
  const started = await sandbox.api("POST", "/agents", { workspace: ws, harness: "fake-replay", repo });
  expect(started.status, `start in ${repo}: ${JSON.stringify(started.json)}`).toBe(201);
  const id = (started.json as { id: string }).id;
  const message = [{ send: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } }];
  expect((await sandbox.api("POST", `/agents/${id}/messages`, { text: JSON.stringify(message) })).status).toBe(202);
  await waitUntil(`agent ${id} done`, WAIT_MS, async () => {
    const { agents } = (await sandbox.api("GET", "/agents")).json as { agents: { id: string; state: string }[] };
    return agents.find((agent) => agent.id === id)?.state === "done" ? true : undefined;
  });
};

const showAgentIn = async (page: Page, garden: Garden): Promise<void> => {
  await click(page.getByRole("complementary", { name: "Agents", exact: true }).getByRole("button", { name: new RegExp(garden.repo) }).first());
  await expect(page.getByRole("banner"), `showing ${garden.name}'s agent`).toContainText(garden.name, { timeout: WAIT_MS });
};
const itemTab = (page: Page, handle: string): Locator => page.getByRole("tablist").getByRole("tab", { name: new RegExp(`^\\s*${handle}\\b`) });
const titleBox = (page: Page): Locator => page.getByRole("textbox", { name: "Title", exact: true });
const binderRow = (page: Page, garden: Garden): Locator =>
  page.getByRole("complementary", { name: "Desk", exact: true }).getByRole("treeitem", { name: new RegExp(`^${garden.binder.name}\\b`) });

test.describe("Two workspaces", () => {
  test("a chat's item link opens the item in its own workspace's strip; showing the other workspace's agent swaps the strip and the Desk, and an unsaved edit is there on return", async ({ sandbox }) => {
    test.setTimeout(120_000);
    const orchard = await addGarden(sandbox, ORCHARD, true);
    const allotment = await addGarden(sandbox, ALLOTMENT, false);
    await agentSaying(sandbox, orchard, ORCHARD.repo, "Look at CH-1 before the pruning.");
    await agentSaying(sandbox, allotment, ALLOTMENT.repo, "The seed tray is sorted.");
    const pageErrors: string[] = [];
    const { page } = await sandbox.launch({
      workspaceAnswer: null,
      env: { [SWITCH.quitAnswer]: "leave" },
      onWindow: async (app) => {
        (await app.firstWindow()).on("pageerror", (error) => pageErrors.push(error.message));
      },
    });
    await waitForConnection(page, "connected", { timeoutMs: 40_000 });

    // Orchard's chat, in a workspace with binders, shows its item link; following it opens the item in orchard's strip.
    await showAgentIn(page, ORCHARD);
    const link = page.getByRole("main").getByRole("log", { name: "Conversation", exact: true }).getByRole("button", { name: "CH-1", exact: true }).last();
    await expect(link, `orchard's chat shows no item link (page errors: ${JSON.stringify(pageErrors)})`).toBeVisible({ timeout: WAIT_MS });
    await click(link);
    await expect(itemTab(page, "CH-1"), "following CH-1 opened no tab").toHaveCount(1, { timeout: WAIT_MS });
    await expect(titleBox(page), "CH-1's form doesn't show").toHaveValue(`Invented for ${ORCHARD.name}`, { timeout: WAIT_MS });
    const edited = "Prune the pear trees before March";
    await titleBox(page).fill(edited);

    // Allotment's agent: orchard's tab goes, and allotment's Desk shows its own binder.
    await showAgentIn(page, ALLOTMENT);
    await expect(itemTab(page, "CH-1"), "orchard's tab still shows on allotment").toHaveCount(0, { timeout: WAIT_MS });
    const desk = page.getByRole("main").getByRole("button", { name: "Desk", exact: true });
    await expect(desk).toHaveAttribute("aria-pressed", "false", { timeout: WAIT_MS });
    await click(desk);
    await expect(binderRow(page, ALLOTMENT), "allotment's Desk doesn't show its binder").toHaveCount(1, { timeout: WAIT_MS });
    await expect(binderRow(page, ORCHARD), "allotment's Desk shows orchard's binder").toHaveCount(0);

    // Back on orchard: its tab, with the unsaved edit.
    await showAgentIn(page, ORCHARD);
    await expect(itemTab(page, "CH-1"), "back on orchard, CH-1's tab is gone").toHaveCount(1, { timeout: WAIT_MS });
    await expect(titleBox(page), "back on orchard, CH-1's unsaved edit is lost").toHaveValue(edited, { timeout: WAIT_MS });
    expect(pageErrors, "page errors").toEqual([]);
  });
});
