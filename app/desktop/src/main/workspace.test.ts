// The workspace control: which workspace the app opens, and which service runs for it. Dialogs are injected; the
// services are the fake service (test/fake-service.ts) or one in this process, in a temp sandbox.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isAlive } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { startService } from "./service-start.ts";
import { loadSettings, savePageSettings, saveSettings } from "./settings.ts";
import { FAKE_SERVICE_ENTRY, inProcessService, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { workspaceControl, type WorkspaceDeps } from "./workspace.ts";

const control = (sandbox: ServiceSandbox, deps: Partial<WorkspaceDeps> = {}) =>
  workspaceControl({
    env: sandbox.env,
    settingsFile: sandbox.settingsFile,
    serviceEntry: FAKE_SERVICE_ENTRY,
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    confirmRestart: () => Promise.reject(new Error("the restart box wasn't expected")),
    log: () => undefined,
    ...deps,
  });

const savedWorkspace = (sandbox: ServiceSandbox) => loadSettings(sandbox.settingsFile, () => undefined).workspace;

const saveWorkspace = (sandbox: ServiceSandbox, workspace: string) =>
  saveSettings(sandbox.settingsFile, { version: 1, workspace, workspaces: {}, askOnQuit: true });

test("a first start whose folder dialog is cancelled opens nothing: no service start, no settings file", async () => {
  const sandbox = serviceSandbox();
  let asked = 0;
  const opened = await control(sandbox, {
    chooseFolder: () => {
      asked += 1;
      return Promise.resolve(undefined);
    },
  }).open();

  expect(opened).toBeUndefined();
  expect(asked).toBe(1);
  expect(existsSync(sandbox.settingsFile)).toBe(false);
  expect(existsSync(path.join(sandbox.base, "state", "wombat", "service.log")), "a service start was attempted").toBe(false);
});

test("a switch asked for while the first start is still in flight waits for it, then replaces its service", async () => {
  const sandbox = serviceSandbox();
  sandbox.env["FAKE_START_DELAY_MS"] = "300";
  const [first, second] = [sandbox.workspace("first"), sandbox.workspace("second")];
  const workspace = control(sandbox, { chooseFolder: () => Promise.resolve(first) });

  const opened = await workspace.open();
  const switched = workspace.switchWorkspace(second);
  const [firstFile, secondFile] = await Promise.all([opened?.service, switched]);

  expect(sandbox.starts().map((start) => start.workspace)).toEqual([first, second]);
  expect(firstFile?.workspace).toBe(first);
  expect(isAlive(firstFile?.pid ?? 0), "the first workspace's service still runs").toBe(false);
  expect(secondFile.workspace).toBe(second);
  expect(savedWorkspace(sandbox)).toBe(second);
});

test("Restart on a service for another workspace stops it and starts one for the saved workspace", async () => {
  const sandbox = serviceSandbox();
  const [saved, other] = [sandbox.workspace("saved"), sandbox.workspace("other")];
  const old = await startService({ env: sandbox.env, entry: FAKE_SERVICE_ENTRY, workspace: other });
  saveWorkspace(sandbox, saved);
  const asked: string[] = [];

  const opened = await control(sandbox, {
    confirmRestart: (workspace) => {
      asked.push(workspace);
      return Promise.resolve(true);
    },
  }).open();

  expect(asked).toEqual([saved]);
  expect(opened?.workspace).toBe(saved);
  expect((await opened?.service)?.workspace).toBe(saved);
  expect(isAlive(old.pid)).toBe(false);
  expect(savedWorkspace(sandbox)).toBe(saved);
});

test("Cancel on a service for another workspace keeps it, and the settings follow its workspace", async () => {
  const sandbox = serviceSandbox();
  const other = sandbox.workspace("other");
  const running = await inProcessService(sandbox, other);
  saveWorkspace(sandbox, sandbox.workspace("saved"));

  const opened = await control(sandbox, { confirmRestart: () => Promise.resolve(false) }).open();

  expect(opened?.workspace).toBe(other);
  expect(await opened?.service).toEqual(running);
  expect(savedWorkspace(sandbox)).toBe(other);
  expect(sandbox.starts()).toEqual([]);
});

test("Cancel on a service that doesn't name its workspace keeps it, and the settings as they are", async () => {
  const sandbox = serviceSandbox();
  const saved = sandbox.workspace("saved");
  const running = await inProcessService(sandbox, undefined);
  saveWorkspace(sandbox, saved);

  const opened = await control(sandbox, { confirmRestart: () => Promise.resolve(false) }).open();

  expect(opened?.workspace).toBe(saved);
  expect(await opened?.service).toEqual(running);
  expect(savedWorkspace(sandbox)).toBe(saved);
});

test("a page's settings change whose save fails leaves the settings as they were, and the page's error names no path", () => {
  const sandbox = serviceSandbox();
  // The settings folder's place is taken by a file, so every save fails (naming the path).
  const blocked = path.join(sandbox.base, "blocked");
  writeFileSync(blocked, "");
  const workspace = control(sandbox, { settingsFile: path.join(blocked, "settings.json") });
  const before = workspace.settings();
  const logged: string[] = [];

  let pageError: unknown;
  try {
    savePageSettings(workspace.updateSettings, { askOnQuit: false }, (line) => logged.push(line));
  } catch (error) {
    pageError = error;
  }

  expect(pageError).toBeInstanceOf(Error);
  expect((pageError as Error).message).not.toContain(sandbox.base);
  expect(logged.join("\n"), "main's log keeps the reason").toContain(blocked);
  expect(workspace.settings()).toEqual(before);
});

test("shutdown stops the running service, and restart then starts one for the saved workspace", async () => {
  const sandbox = serviceSandbox();
  const saved = sandbox.workspace("saved");
  saveWorkspace(sandbox, saved);
  const workspace = control(sandbox);
  const first = await workspace.restart();

  await workspace.shutdown();
  expect(isAlive(first.pid), "the service still runs").toBe(false);
  expect(existsSync(sandbox.discoveryPath)).toBe(false);

  const second = await workspace.restart();
  expect(second.pid).not.toBe(first.pid);
  expect(second.workspace).toBe(saved);
  expect(isAlive(second.pid)).toBe(true);
});

test("a switch that would stop a service for another workspace asks first; Cancel stops and saves nothing", async () => {
  const sandbox = serviceSandbox();
  const [current, next] = [sandbox.workspace("current"), sandbox.workspace("next")];
  saveWorkspace(sandbox, current);
  const asked: { folder: string; running: number | undefined }[] = [];
  const workspace = control(sandbox, {
    confirmRestart: (folder, running) => {
      asked.push({ folder, running });
      return Promise.resolve(false);
    },
  });
  const running = await workspace.restart();

  expect(await workspace.confirmSwitch(next)).toBe(false);
  // The fake service has no GET /agents, so the count is unknown.
  expect(asked).toEqual([{ folder: next, running: undefined }]);
  expect(isAlive(running.pid)).toBe(true);
  expect(sandbox.starts()).toHaveLength(1);
  expect(savedWorkspace(sandbox)).toBe(current);
});

test("a switch that stops no service doesn't ask: none runs, or the running one is for the chosen workspace", async () => {
  const sandbox = serviceSandbox();
  const saved = sandbox.workspace("saved");
  saveWorkspace(sandbox, saved);
  const workspace = control(sandbox);

  expect(await workspace.confirmSwitch(sandbox.workspace("other"))).toBe(true);
  await workspace.restart();
  expect(await workspace.confirmSwitch(saved)).toBe(true);
});
