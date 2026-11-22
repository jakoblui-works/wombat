// The workspace, the settings file and the service start, against the built app. Every launch runs in its own
// sandbox (app-fixtures.ts): temp profile, runtime and state dirs, fake systemd, fake agents.
import { statSync } from "node:fs";
import path from "node:path";
import { expect, isAlive, startAgent, test, SWITCH, waitForConnection, waitUntil, WAIT_MS, workspaceId } from "./app-fixtures.ts";

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
