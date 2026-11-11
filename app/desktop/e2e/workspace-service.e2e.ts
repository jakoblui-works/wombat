// T5: the workspace, the settings file and the service start, against the built app. Every launch runs in its own
// sandbox (app-fixtures.ts): temp profile, runtime and state dirs, fake systemd, fake agents.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { HOLDER_WAIT_MS } from "@wombat/shared/discovery";
import { expect, isAlive, startAgent, test, SWITCH, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

const mode = (file: string): number => statSync(file).mode & 0o777;

// One settings file as the app writes it, naming `workspace`.
const settingsFor = (workspace: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  workspace,
  workspaces: {},
  askOnQuit: true,
  ...extra,
});

test.describe("T5: first start", () => {
  test("a fresh profile starts a service for the chosen workspace and remembers it in a private settings file", async ({ sandbox }) => {
    await sandbox.launch({ workspaceAnswer: sandbox.workspace });

    // The discovery file names the workspace (additive field), and its service is the one its token proves.
    const file = await sandbox.waitForService();
    expect(file.workspace, "the discovery file doesn't name the service's workspace").toBe(sandbox.workspace);
    expect(sandbox.liveServices()).toEqual([file.pid]);

    // Contract "Settings file": $XDG_CONFIG_HOME/Wombat/settings.json, 0600 in a 0700 folder, naming the workspace.
    const settings = sandbox.settingsPath();
    await waitUntil("settings.json to name the workspace", WAIT_MS, () => (sandbox.readSettings()?.["workspace"] === sandbox.workspace ? true : undefined));
    expect(mode(settings).toString(8), "settings.json isn't 0600").toBe("600");
    expect(mode(path.dirname(settings)).toString(8), "the settings folder isn't 0700").toBe("700");

    // The service's output goes to a private log in the state dir.
    const log = path.join(sandbox.stateDir, "wombat", "service.log");
    expect(mode(log).toString(8), "service.log isn't 0600").toBe("600");
  });

  test("a second start reuses the running service instead of starting another", async ({ sandbox }) => {
    const first = await sandbox.launch({ workspaceAnswer: sandbox.workspace });
    const file = await sandbox.waitForService();
    await first.quit();
    await first.exited();
    expect(isAlive(file.pid), "closing the app stopped the service").toBe(true);

    // No workspace answer this time: the app must take it from the settings it saved, without asking.
    const second = await sandbox.launch({ workspaceAnswer: null });
    await waitForConnection(second.page, "connected");
    expect(sandbox.discovery()?.pid, "the second start replaced the service").toBe(file.pid);
    expect(sandbox.serviceStarts(), "the second start spawned another service").toEqual([file.pid]);
  });

  // Lasting check "One service per runtime dir": two apps (two profiles) on one runtime dir, started at once.
  test("two apps started at once on one runtime dir leave one service, and both connect to it", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const [a, b] = await Promise.all([
      sandbox.launch({ profile: sandbox.profile }),
      sandbox.launch({ profile: sandbox.newProfile() }),
    ]);
    await Promise.all([waitForConnection(a.page, "connected"), waitForConnection(b.page, "connected")]);
    const file = await sandbox.waitForService();
    // The start that lost the lock may still be exiting when both pages report connected. On a timeout the assert
    // below says which services are still running.
    await waitUntil("one live service", WAIT_MS, () => (sandbox.liveServices().length === 1 ? true : undefined)).catch(() => undefined);
    expect(sandbox.liveServices(), "more than one service is running").toEqual([file.pid]);
  });
});

test.describe("T5: settings that can't all be read", () => {
  // The answer offered if the app (wrongly) asks again: a different folder, so asking shows.
  test("an invalid field falls back alone: the workspace in the same file is kept", async ({ sandbox }) => {
    const other = sandbox.newWorkspace("other");
    sandbox.writeSettings(settingsFor(sandbox.workspace, { askOnQuit: "sometimes" }));
    await sandbox.launch({ workspaceAnswer: other });
    const file = await sandbox.waitForService();
    expect(file.workspace, "one invalid field cost the saved workspace").toBe(sandbox.workspace);
    expect(sandbox.readSettings()?.["workspace"]).toBe(sandbox.workspace);
  });

  test("a settings file that isn't JSON is kept aside as settings.json.bad, byte for byte, and the app starts afresh", async ({ sandbox }) => {
    const broken = `{ "version": 1, "workspace": ${JSON.stringify(sandbox.workspace)}, oops`;
    sandbox.writeSettings(broken);
    const answer = sandbox.newWorkspace("chosen");
    await sandbox.launch({ workspaceAnswer: answer });
    const file = await sandbox.waitForService();
    expect(file.workspace).toBe(answer);
    await waitUntil("settings.json to name the chosen workspace", WAIT_MS, () => (sandbox.readSettings()?.["workspace"] === answer ? true : undefined));
    expect(readFileSync(`${sandbox.settingsPath()}.bad`, "utf8"), "the unreadable file wasn't kept aside").toBe(broken);
  });
});

test.describe("T5: a running service for another workspace", () => {
  // The old service's shutdown is held (fake `systemctl stop` waits on a gate) for longer than a new start waits for
  // the lock (HOLDER_WAIT_MS), so a switch that starts the new service before the old one is gone leaves nothing
  // running.
  const HOLD_PAST_LOCK_WAIT_MS = HOLDER_WAIT_MS + 1_500;

  test("Restart stops the old service and its agents, then a service for the saved workspace runs and stays up", async ({ makeSandbox }) => {
    test.setTimeout(90_000);
    const sandbox = makeSandbox({ holdStop: true });
    const old = sandbox.newWorkspace("old");
    const running = await sandbox.startService(old);
    await startAgent(sandbox, "fake-reply");
    const oldAgents = sandbox.agentPids();
    expect(oldAgents.length).toBeGreaterThan(0);

    sandbox.writeSettings(settingsFor(sandbox.workspace));
    await sandbox.launch({ workspaceAnswer: null, env: { [SWITCH.restartAnswer]: "restart" } });

    // Once the old service's shutdown reaches the slice stop, hold it, then let it finish.
    await waitUntil("the old service's shutdown to stop its slice", WAIT_MS, () =>
      sandbox.systemd.calls().some(({ tool, args }) => tool === "systemctl" && args.includes("stop")) ? true : undefined,
    );
    const release = setTimeout(() => sandbox.releaseStop(), HOLD_PAST_LOCK_WAIT_MS);
    let file: Awaited<ReturnType<typeof sandbox.waitForService>>;
    try {
      file = await sandbox.waitForService((found) => found.workspace === sandbox.workspace, 60_000);
    } finally {
      clearTimeout(release);
    }
    await waitUntil("the old service to exit", WAIT_MS, () => (isAlive(running.pid) ? undefined : true));
    expect(oldAgents.filter(isAlive), "the old service's agents still run").toEqual([]);
    // Still the new service, still up, after the old one is gone.
    expect(isAlive(file.pid)).toBe(true);
    expect((await sandbox.api("GET", "/version")).status).toBe(200);
    expect(sandbox.discovery()?.pid).toBe(file.pid);
    expect(sandbox.readSettings()?.["workspace"]).toBe(sandbox.workspace);
  });

  test("Cancel keeps the running service, and the settings follow its workspace", async ({ sandbox }) => {
    const old = sandbox.newWorkspace("old");
    const running = await sandbox.startService(old);
    sandbox.writeSettings(settingsFor(sandbox.workspace));
    const launched = await sandbox.launch({ workspaceAnswer: null, env: { [SWITCH.restartAnswer]: "cancel" } });

    await waitUntil("settings.json to follow the running service's workspace", WAIT_MS, () => (sandbox.readSettings()?.["workspace"] === old ? true : undefined));
    await waitForConnection(launched.page, "connected");
    expect(sandbox.discovery()?.pid, "the running service was replaced").toBe(running.pid);
    expect(sandbox.liveServices()).toEqual([running.pid]);
    const stops = sandbox.systemd.calls().filter(({ tool, args }) => tool === "systemctl" && args.includes("stop"));
    expect(stops, "the running service was shut down").toEqual([]);
  });
});

// T7 (Switch Workspace through the bridge): the one path where the running app switches, reconnects and reloads.
test.describe("T7: Switch Workspace", () => {
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
