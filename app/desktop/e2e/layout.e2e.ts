// The saved layout, against the built app. Every launch runs in its own sandbox (app-fixtures.ts): temp profile,
// runtime and state dirs, fake systemd, fake agents. Tabs open the way a notification click opens them (main sends
// CHANNELS.openAgent, once); the split is a tab dragged to the right edge of its group, as the user would make it.
import type { Page } from "@playwright/test";
import { agentSummary, expect, type GroupView, layoutOf, openAgent, type Sandbox, sendOpenAgent, startAgent, SWITCH, tabCount, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

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

test.describe("saved layout", () => {
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
});

/** Two fake agents in a service the test started, and the app launched on it (leaving agents running at quit). */
const appWithTwoAgents = async (sandbox: Sandbox) => {
  await sandbox.startService(sandbox.workspace);
  const agents = [await startAgent(sandbox, "fake-reply"), await startAgent(sandbox, "fake-reply")] as [string, string];
  const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  await waitForConnection(launched.page, "connected");
  return { agents, launched };
};

const waitForTabs = async (page: Page, count: number, what: string): Promise<void> => {
  let seen = 0;
  await waitUntil(what, WAIT_MS, async () => ((seen = await tabCount(page)) === count ? true : undefined)).catch((error: unknown) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)} (${String(seen)} tabs open)`);
  });
};

// The open tabs follow the agents list (one rule, the registry's isKnown, for the restore and live).
test.describe("chat tabs follow the agents list", () => {
  test("a chat tab closes when its agent is deleted, and doesn't come back on restart", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const { agents, launched } = await appWithTwoAgents(sandbox);
    await openAgent(launched, agents[0], 1);
    await openAgent(launched, agents[1], 2);
    await waitUntil("both chats in the saved layout", WAIT_MS, () => {
      const text = JSON.stringify(savedLayout(sandbox, sandbox.workspace) ?? null);
      return agents.every((id) => text.includes(id)) ? true : undefined;
    });

    const deleted = await sandbox.api("DELETE", `/agents/${agents[1]}`);
    expect(deleted.status, JSON.stringify(deleted.json)).toBeLessThan(300);
    await waitForTabs(launched.page, 1, "the deleted agent's chat tab to close");

    await launched.quit();
    await launched.exited();
    const again = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" }, workspaceAnswer: null });
    await waitForConnection(again.page, "connected");
    // From no tabs straight to the restored ones: the deleted agent's tab would make it 2.
    await waitForTabs(again.page, 1, "the restored layout with only the remaining chat");
  });

  test("an open-agent for an id the service doesn't list opens no tab", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const { agents, launched } = await appWithTwoAgents(sandbox);
    const consoleLines: string[] = [];
    launched.page.on("console", (message) => consoleLines.push(message.text()));
    await openAgent(launched, agents[0], 1);

    const unknown = "agent-not-listed-7c1d";
    await sendOpenAgent(launched.app, unknown);
    // Handled in order: once the listed agent's tab is there, the unknown one has been dealt with.
    await openAgent(launched, agents[1], 2);
    expect(await tabCount(launched.page), "a tab opened for an agent the service doesn't list").toBe(2);
    expect(consoleLines.filter((line) => line.includes(unknown)), "the console names the unknown id").toEqual([]);
  });

  test("a cold start (the app starts the service; the first agents read is refused) still drops a deleted agent's saved tab", async ({ sandbox }) => {
    test.setTimeout(120_000);
    const { agents, launched } = await appWithTwoAgents(sandbox);
    await openAgent(launched, agents[0], 1);
    await openAgent(launched, agents[1], 2);
    await waitUntil("both chats in the saved layout", WAIT_MS, () => {
      const text = JSON.stringify(savedLayout(sandbox, sandbox.workspace) ?? null);
      return agents.every((id) => text.includes(id)) ? true : undefined;
    });
    await launched.quit();
    await launched.exited();

    // The agent is deleted while the app is closed, then the service stops (history kept): the next start is cold.
    const deleted = await sandbox.api("DELETE", `/agents/${agents[1]}`);
    expect(deleted.status, JSON.stringify(deleted.json)).toBeLessThan(300);
    const before = sandbox.liveServices();
    expect((await sandbox.api("POST", "/shutdown")).status).toBe(202);
    await waitUntil("the service to stop", WAIT_MS, () => (sandbox.liveServices().some((pid) => before.includes(pid)) ? undefined : true));

    const cold = await sandbox.launch({ workspaceAnswer: null });
    // The most tabs ever open: the restore itself must drop the tab, not a later close of a tab it restored.
    await cold.page.evaluate(() => {
      const w = window as unknown as { __e2eMostTabs: number };
      w.__e2eMostTabs = document.querySelectorAll(".dv-tab").length;
      new MutationObserver(() => {
        w.__e2eMostTabs = Math.max(w.__e2eMostTabs, document.querySelectorAll(".dv-tab").length);
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await waitForConnection(cold.page, "connected");
    expect(await agentSummary(sandbox, agents[0]), "the remaining agent isn't listed after the service restarted").toBeDefined();
    await waitForTabs(cold.page, 1, "the restored layout with only the remaining (stopped) agent's chat");
    const most = await cold.page.evaluate(() => (window as unknown as { __e2eMostTabs: number }).__e2eMostTabs);
    expect(most, "the restore brought back the deleted agent's tab (closed only afterwards)").toBe(1);
  });
});
