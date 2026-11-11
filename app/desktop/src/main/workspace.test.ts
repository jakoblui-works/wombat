// The workspace control: which workspace the app opens, and which service runs for it. Dialogs are injected; the
// services are the fake service (test/fake-service.ts) or one in this process, in a temp sandbox.
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import { isRunning, startService } from "./service-start.ts";
import { loadSettings, saveSettings } from "./settings.ts";
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
  expect(isRunning(firstFile?.pid ?? 0), "the first workspace's service still runs").toBe(false);
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
  expect(isRunning(old.pid)).toBe(false);
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
