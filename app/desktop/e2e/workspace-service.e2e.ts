// The workspace, the settings file and the service start, against the built app. Every launch runs in its own
// sandbox (app-fixtures.ts): temp profile, runtime and state dirs, fake systemd, fake agents.
import { statSync } from "node:fs";
import path from "node:path";
import { expect, isAlive, startAgent, test, SWITCH, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

const mode = (file: string): number => statSync(file).mode & 0o777;

// One settings file as the app writes it, naming `workspace`.
const settingsFor = (workspace: string) => ({ version: 1, workspace, workspaces: {}, askOnQuit: true });

test.describe("first start", () => {
  test("a fresh profile starts a service for the chosen workspace with private files, and a second start reuses it", async ({ sandbox }) => {
    // A quit stops a service without agent processes (nothing left running unseen); one agent and the answer Keep
    // leave it running.
    const first = await sandbox.launch({ workspaceAnswer: sandbox.workspace, env: { [SWITCH.quitAnswer]: "leave" } });
    // The discovery file names the workspace, and its service is the one its token proves.
    const file = await sandbox.waitForService();
    expect(file.workspace, "the discovery file doesn't name the service's workspace").toBe(sandbox.workspace);
    expect(sandbox.liveServices()).toEqual([file.pid]);
    // The settings file and the service's log name the user's folders: 0600, the settings in a 0700 folder.
    const settings = sandbox.settingsPath();
    await waitUntil("settings.json to name the workspace", WAIT_MS, () => (sandbox.readSettings()?.["workspace"] === sandbox.workspace ? true : undefined));
    expect(mode(settings).toString(8), "settings.json isn't 0600").toBe("600");
    expect(mode(path.dirname(settings)).toString(8), "the settings folder isn't 0700").toBe("700");
    expect(mode(path.join(sandbox.stateDir, "wombat", "service.log")).toString(8), "service.log isn't 0600").toBe("600");

    await startAgent(sandbox, "fake-reply");
    await first.quit();
    await first.exited();
    expect(isAlive(file.pid), "closing the app stopped the service").toBe(true);

    // No workspace answer this time: the app must take it from the settings it saved, without asking.
    const second = await sandbox.launch({ workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    expect(sandbox.discovery()?.pid, "the second start replaced the service").toBe(file.pid);
    expect(sandbox.serviceStarts(), "the second start spawned another service").toEqual([file.pid]);
  });
});

// Switch Workspace through the bridge: the one path where the running app switches, reconnects and reloads.
test.describe("Switch Workspace", () => {
  test("workspace.switch() restarts the service for the chosen folder, reloads the page, and remembers the folder", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const next = sandbox.newWorkspace("next");
    // The saved workspace opens; the folder picker's answer (WOMBAT_E2E_WORKSPACE) is the one switched to.
    sandbox.writeSettings(settingsFor(sandbox.workspace));
    const { page } = await sandbox.launch({ workspaceAnswer: next, env: { [SWITCH.restartAnswer]: "restart" } });
    await waitForConnection(page, "connected");
    const before = await sandbox.waitForService((file) => file.workspace === sandbox.workspace);

    await page.evaluate(() => {
      (window as unknown as { __e2eBeforeSwitch?: boolean }).__e2eBeforeSwitch = true;
    });
    // The page reloads while the call is out, so its answer may never come back.
    await page
      .evaluate(() => (window as unknown as { wombat: { workspace: { switch: () => Promise<void> } } }).wombat.workspace.switch())
      .catch(() => undefined);

    const after = await sandbox.waitForService((file) => file.workspace === next, 40_000);
    await waitUntil("the old service to exit", WAIT_MS, () => (isAlive(before.pid) ? undefined : true));
    expect(after.pid).not.toBe(before.pid);
    await waitUntil("settings.json to name the new workspace", WAIT_MS, () => (sandbox.readSettings()?.["workspace"] === next ? true : undefined));
    await waitUntil("the page to reload", WAIT_MS, async () => {
      const marked = await page
        .evaluate(() => (window as unknown as { __e2eBeforeSwitch?: boolean }).__e2eBeforeSwitch === true)
        .catch(() => true);
      return marked ? undefined : true;
    });
    await waitForConnection(page, "connected");
    const root = await page.evaluate(() =>
      (window as unknown as { wombat: { workspace: { get: () => Promise<{ root: string }> } } }).wombat.workspace.get().then(({ root: r }) => r),
    );
    expect(root).toBe(next);
  });
});
