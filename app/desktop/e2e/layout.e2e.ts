// The saved layout, against the built app. Every launch runs in its own sandbox (app-fixtures.ts): temp profile,
// runtime and state dirs, fake systemd, fake agents. Tabs open the way a notification click opens them (main sends
// CHANNELS.openAgent, once); the split is a tab dragged to the right edge of its group, as the user would make it.
import { click, expect, type GroupView, layoutOf, openAgent, type Sandbox, sendOpenAgent, startAgent, SWITCH, tabCount, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

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
  test("split, open two tabs, add an empty group, restart: the same layout returns, the empty group included", async ({ sandbox }) => {
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
    // An empty group too, from the first group's split button (a click splits right): it is kept like any other.
    await click(first.page.locator(".dv-groupview").first().getByRole("button", { name: /^Split\b/i }).first());
    await waitUntil("an empty group beside the two chats", WAIT_MS, async () => {
      const groups = await layoutOf(first.page);
      return groups.length === 3 && groups.filter((group) => group.tabs.length === 0).length === 1 ? true : undefined;
    });
    const before = await layoutOf(first.page);

    // The split, the empty group and both chats are saved for this workspace before the app quits.
    await waitUntil("the split layout in settings.json", WAIT_MS, () => {
      const layout = savedLayout(sandbox, sandbox.workspace);
      const text = JSON.stringify(layout ?? null);
      return savedGroups(layout).length === 3 && agents.every((id) => text.includes(id)) ? true : undefined;
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

// The open tabs follow the agents list (one rule, the registry's isKnown, for the restore and live).
test.describe("chat tabs follow the agents list", () => {
});
