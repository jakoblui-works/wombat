// Zoom, against the built app (interface-S1 T1; contracts "Main commands over the bridge" and "Zoom level in
// settings"). The zoom keys are the page's (the registry's keydown listener); each press runs one main command, main
// applies the level to the window, tells the page through onZoom and saves it as settings.json's top-level
// zoomLevel at once; the next start applies the saved level when the page loads. Every launch runs in its own
// sandbox (app-fixtures.ts). Levels are compared with each other and with what one zoom.in over the bridge does, never
// with a step size, so the zoom steps and bounds can change without touching this file.
import type { Page } from "@playwright/test";
import {
  bridgeCommand,
  click,
  expect,
  type LaunchedApp,
  type Sandbox,
  SWITCH,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
  watchZoom,
  zoomLevel,
  zoomsHeard,
} from "./app-fixtures.ts";

const savedZoom = (sandbox: Sandbox): unknown => sandbox.readSettings()?.["zoomLevel"];

/** Waits until main's level differs from `from`, and settles there: saved, and the last level the page heard. */
const settledAfter = async (sandbox: Sandbox, launched: LaunchedApp, from: number | undefined): Promise<number> => {
  const level = await waitUntil(`the zoom level to change from ${String(from)}`, WAIT_MS, async () => {
    const now = await zoomLevel(launched.app);
    return now !== undefined && now !== from ? now : undefined;
  });
  return settled(sandbox, launched, level);
};

/** Waits until settings.json holds `level` and the page last heard `level`; returns main's level then. */
const settled = async (sandbox: Sandbox, launched: LaunchedApp, level: number): Promise<number> => {
  await waitUntil(`zoomLevel ${String(level)} at the top level of settings.json`, WAIT_MS, () => (savedZoom(sandbox) === level ? true : undefined));
  await waitUntil(`the page to hear zoom level ${String(level)} through onZoom`, WAIT_MS, async () => ((await zoomsHeard(launched.page)).at(-1) === level ? true : undefined));
  const now = await zoomLevel(launched.app);
  expect(now, "main's level moved on after it was saved: one key press ran more than one command").toBe(level);
  return level;
};

const press = (page: Page, key: string): Promise<void> => page.keyboard.press(key);

test.describe("zoom", () => {
  test("the zoom keys zoom app-wide, one command a press; the level is saved at once and comes back after a restart; Ctrl+Numpad0 resets it", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const env = { [SWITCH.quitAnswer]: "leave" };
    await sandbox.startService(sandbox.workspace);
    const first = await sandbox.launch({ env });
    await waitForConnection(first.page, "connected");
    await watchZoom(first.page);
    expect(await zoomLevel(first.app), "a fresh profile starts at zoom level 0").toBe(0);

    // What one zoom.in does, run over the bridge: the yardstick for one key press.
    expect(await bridgeCommand(first.page, "zoom.in")).toBe("resolved");
    const oneStep = await settledAfter(sandbox, first, 0);
    expect(oneStep, "zoom.in zoomed out").toBeGreaterThan(0);
    expect(await bridgeCommand(first.page, "zoom.reset")).toBe("resolved");
    await settled(sandbox, first, 0);

    await press(first.page, "Control+Equal");
    expect(await settledAfter(sandbox, first, 0), "one Ctrl+= is one zoom.in").toBe(oneStep);
    await press(first.page, "Control+Equal");
    const twoSteps = await settledAfter(sandbox, first, oneStep);
    expect(twoSteps, "a second Ctrl+= didn't zoom in further").toBeGreaterThan(oneStep);
    await press(first.page, "Control+Minus");
    expect(await settledAfter(sandbox, first, twoSteps), "Ctrl+- undoes one Ctrl+=").toBe(oneStep);
    await press(first.page, "Control+Equal");
    const kept = await settledAfter(sandbox, first, oneStep);
    expect(kept).toBe(twoSteps);

    // A save from the page (the right sidebar's toggle saves the layout) keeps main's zoomLevel.
    const toggle = first.page.getByRole("button", { name: /^Needs me\b/ });
    await click(toggle);
    const open = (await toggle.getAttribute("aria-pressed")) === "true";
    await waitUntil("the page's layout save after the toggle", WAIT_MS, () => {
      const layout = (sandbox.readSettings()?.["workspaces"] as Record<string, { layout?: { sidebars?: { rightCollapsed?: boolean } } }> | undefined)?.[sandbox.workspace]?.layout;
      return layout?.sidebars?.rightCollapsed === !open ? true : undefined;
    });
    expect(savedZoom(sandbox), "the page's settings save dropped zoomLevel").toBe(kept);

    await first.quit();
    await first.exited();

    const second = await sandbox.launch({ env, workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    let restored: number | undefined;
    await waitUntil("the saved zoom level applied after the restart", WAIT_MS, async () => ((restored = await zoomLevel(second.app)) === kept ? true : undefined)).catch(
      () => undefined,
    );
    expect(restored, "the zoom level after the restart").toBe(kept);

    await watchZoom(second.page);
    await press(second.page, "Control+Numpad0");
    expect(await settledAfter(sandbox, second, kept), "Ctrl+Numpad0 resets the zoom").toBe(0);
  });
});
