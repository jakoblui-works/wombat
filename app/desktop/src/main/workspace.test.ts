// The workspace control: which workspace the app opens, and which service runs for it. Dialogs are injected; the
// services are the fake service (test/fake-service.ts) or one in this process, in a temp sandbox.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import { isRunning, startService } from "./service-start.ts";
import { loadSettings, savePageSettings, saveSettings } from "./settings.ts";
import { FAKE_SERVICE_ENTRY, inProcessService, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { workspaceControl, workspaceRepos, type WorkspaceDeps } from "./workspace.ts";

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

test("workspaceRepos lists the root's immediate subfolders that are git repos, worktrees included", async () => {
  const sandbox = serviceSandbox();
  const root = sandbox.workspace("main");
  mkdirSync(path.join(root, "web", ".git"), { recursive: true });
  mkdirSync(path.join(root, "api"), { recursive: true });
  writeFileSync(path.join(root, "api", ".git"), "gitdir: /elsewhere\n");
  mkdirSync(path.join(root, "notes"), { recursive: true });
  mkdirSync(path.join(root, "notes", "nested", ".git"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "");

  expect(await workspaceRepos(root)).toEqual(["api", "web"]);
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
  expect(isRunning(first.pid), "the service still runs").toBe(false);
  expect(existsSync(sandbox.discoveryPath)).toBe(false);

  const second = await workspace.restart();
  expect(second.pid).not.toBe(first.pid);
  expect(second.workspace).toBe(saved);
  expect(isRunning(second.pid)).toBe(true);
});
