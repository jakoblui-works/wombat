// T9: the saved layout, against the built app. Every launch runs in its own sandbox (app-fixtures.ts): temp profile,
// runtime and state dirs, fake systemd, fake agents. Tabs open the way a notification click opens them (main sends
// CHANNELS.openAgent, once); the split is a tab dragged to the right edge of its group, as the user would make it.
import type { ElectronApplication, Page } from "@playwright/test";
import { CHANNELS } from "../src/shared/bridge.ts";
import { expect, type LaunchedApp, type Sandbox, startAgent, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

type GroupView = { tabs: string[]; active: string | undefined };

/** Asks the page to open an agent's chat, as main does for a notification click. */
const sendOpenAgent = (app: ElectronApplication, agentId: string): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, [channel, id]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(channel, id);
    },
    [CHANNELS.openAgent, agentId] as const,
  );

// 0 while the page is still loading (its context may be replaced under the count).
const tabCount = (page: Page): Promise<number> => page.locator(".dv-tab").count().catch(() => 0);

/** Opens the agent's chat once, as one notification click would, and waits for its tab (the `tabsAfter`th). */
const openAgent = async (launched: LaunchedApp, agentId: string, tabsAfter: number): Promise<void> => {
  await sendOpenAgent(launched.app, agentId);
  await waitUntil(`the chat tab of ${agentId}`, WAIT_MS, async () => ((await tabCount(launched.page)) >= tabsAfter ? true : undefined));
};

/** The editor's groups, left to right then top to bottom, each with its tabs' text and the active tab's. */
const layoutOf = (page: Page): Promise<GroupView[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".dv-groupview")]
      .map((group) => {
        const box = group.getBoundingClientRect();
        const tabs = [...group.querySelectorAll<HTMLElement>(".dv-tab")];
        return {
          x: box.x,
          y: box.y,
          tabs: tabs.map((tab) => (tab.textContent ?? "").trim()),
          active: group.querySelector<HTMLElement>(".dv-tab.dv-active-tab")?.textContent?.trim(),
        };
      })
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map(({ tabs, active }) => ({ tabs, active })),
  );

/** Every leaf (group) in a saved dockview grid, read loosely: the test checks the app's file, not its types. */
const savedGroups = (layout: unknown): unknown[] => {
  const walk = (node: unknown): unknown[] => {
    const { type, data } = (node ?? {}) as { type?: unknown; data?: unknown };
    if (type === "leaf") return [data];
    return type === "branch" && Array.isArray(data) ? data.flatMap(walk) : [];
  };
  return walk((layout as { dockview?: { grid?: { root?: unknown } } } | undefined)?.dockview?.grid?.root);
};

const savedLayout = (sandbox: Sandbox, workspace: string): unknown =>
  (sandbox.readSettings()?.["workspaces"] as Record<string, { layout?: unknown }> | undefined)?.[workspace]?.layout;

test.describe("T9: saved layout", () => {
  test("split, open two tabs, restart: the same layout returns", async ({ sandbox }) => {
    test.setTimeout(90_000);
    // Leave the agents running at quit, so the second start finds them and keeps their tabs.
    const env = { [SWITCH.quitAnswer]: "leave" };
    // The service and its agents run before the app starts, so the first open is sent as soon as the window exists:
    // before the page has subscribed (the preload holds it) and before the layout restore (the page queues it).
    await sandbox.startService(sandbox.workspace);
    const agents = [await startAgent(sandbox, "fake-reply"), await startAgent(sandbox, "fake-reply")];
    const first = await sandbox.launch({ env, onWindow: (app) => sendOpenAgent(app, agents[0] as string) });
    await waitUntil("the chat tab opened before the page loaded", WAIT_MS, async () => ((await tabCount(first.page)) >= 1 ? true : undefined));
    await waitForConnection(first.page, "connected");
    await openAgent(first, agents[1] as string, 2);

    // Split: the active (second) tab dragged to the right edge of its group's content.
    const tab = first.page.locator(".dv-tab.dv-active-tab").first();
    const content = first.page.locator(".dv-groupview .dv-content-container").first();
    const box = await content.boundingBox();
    expect(box, "the editor group has no size").not.toBeNull();
    await tab.dragTo(content, { targetPosition: { x: (box?.width ?? 0) * 0.95, y: (box?.height ?? 0) / 2 } });
    await waitUntil("the editor to split into two groups of one tab each", WAIT_MS, async () => {
      const groups = await layoutOf(first.page);
      return groups.length === 2 && groups.every((group) => group.tabs.length === 1) ? true : undefined;
    });
    const before = await layoutOf(first.page);

    // The split and both chats are saved for this workspace before the app quits.
    await waitUntil("the split layout in settings.json", WAIT_MS, () => {
      const layout = savedLayout(sandbox, sandbox.workspace);
      const text = JSON.stringify(layout ?? null);
      return savedGroups(layout).length === 2 && agents.every((id) => text.includes(id)) ? true : undefined;
    });
    await first.quit();
    await first.exited();

    const second = await sandbox.launch({ env, workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    let after: GroupView[] = [];
    await waitUntil("the saved layout to come back", WAIT_MS, async () => {
      after = await layoutOf(second.page);
      return JSON.stringify(after) === JSON.stringify(before) ? true : undefined;
    }).catch(() => undefined);
    expect(after, "the layout after the restart").toEqual(before);
  });

  // The page reloads on a switch; a save during unload (or one landing mid-switch) would write the old workspace's
  // layout under the new one.
  test("a workspace switch never saves the old workspace's tabs into the new one's layout", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const next = sandbox.newWorkspace("next");
    sandbox.writeSettings({ version: 1, workspace: sandbox.workspace, workspaces: {}, askOnQuit: true });
    const launched = await sandbox.launch({ workspaceAnswer: next, env: { [SWITCH.restartAnswer]: "restart" } });
    const { page } = launched;
    await waitForConnection(page, "connected");
    await sandbox.waitForService((file) => file.workspace === sandbox.workspace);
    const agents = [await startAgent(sandbox, "fake-reply"), await startAgent(sandbox, "fake-reply")];

    // Saving works: the first tab reaches this workspace's layout.
    await openAgent(launched, agents[0] as string, 1);
    await waitUntil("the first tab in the workspace's saved layout", WAIT_MS, () =>
      JSON.stringify(savedLayout(sandbox, sandbox.workspace) ?? null).includes(agents[0] as string) ? true : undefined,
    );

    // A second tab, and the switch at once: its save is still pending when the page unloads.
    await openAgent(launched, agents[1] as string, 2);
    await page.evaluate(() => {
      (window as unknown as { __e2eBeforeSwitch?: boolean }).__e2eBeforeSwitch = true;
    });
    await page
      .evaluate(() => (window as unknown as { wombat: { workspace: { switch: () => Promise<void> } } }).wombat.workspace.switch())
      .catch(() => undefined);

    await sandbox.waitForService((file) => file.workspace === next, 40_000);
    await waitUntil("the page to reload", WAIT_MS, async () => {
      const marked = await page.evaluate(() => (window as unknown as { __e2eBeforeSwitch?: boolean }).__e2eBeforeSwitch === true).catch(() => true);
      return marked ? undefined : true;
    });
    await waitForConnection(page, "connected");

    const nextLayout = JSON.stringify(savedLayout(sandbox, next) ?? null);
    for (const id of agents) expect(nextLayout, `the new workspace's layout holds the old workspace's tab ${id}`).not.toContain(id);
    expect(JSON.stringify(savedLayout(sandbox, sandbox.workspace) ?? null), "the old workspace's layout was lost").toContain(agents[0]);
  });
});
