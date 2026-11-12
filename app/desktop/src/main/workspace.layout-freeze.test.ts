// A switch reloads the page after it saved the new workspace; until the reloaded page reads its settings, a layout
// the old page sends (a save already on its way, or one that fires mid-switch) would land under the new workspace.
import path from "node:path";
import { expect, test } from "vitest";

import { FAKE_SERVICE_ENTRY, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { workspaceControl } from "./workspace.ts";

const control = (sandbox: ServiceSandbox, serviceEntry = FAKE_SERVICE_ENTRY) =>
  workspaceControl({
    env: sandbox.env,
    settingsFile: sandbox.settingsFile,
    serviceEntry,
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    confirmRestart: () => Promise.reject(new Error("the restart box wasn't expected")),
    log: () => undefined,
  });

const layouts = (sandbox: ServiceSandbox) =>
  Object.fromEntries(Object.entries(loadSettings(sandbox.settingsFile, () => undefined).workspaces).map(([root, { layout }]) => [path.basename(root), layout]));

test("from the start of a switch until the page's next settings read, a layout from the page is dropped; the rest of the patch is saved", async () => {
  const sandbox = serviceSandbox();
  sandbox.env["FAKE_START_DELAY_MS"] = "200";
  const [first, second] = [sandbox.workspace("first"), sandbox.workspace("second")];
  saveSettings(sandbox.settingsFile, { version: 1, workspace: first, workspaces: {}, askOnQuit: true });
  const workspace = control(sandbox);
  workspace.setPageSettings({ layout: { tabs: 1 } });

  const switched = workspace.switchWorkspace(second);
  workspace.setPageSettings({ layout: { tabs: 2 }, askOnQuit: false });
  await switched;
  workspace.setPageSettings({ layout: { tabs: 3 } });
  expect(layouts(sandbox)).toEqual({ first: { tabs: 1 } });
  expect(workspace.settings().askOnQuit).toBe(false);

  // The reloaded page reads its settings: its own saves count again.
  expect(workspace.pageSettings()).toEqual({ askOnQuit: false });
  workspace.setPageSettings({ layout: { tabs: 4 } });
  expect(layouts(sandbox)).toEqual({ first: { tabs: 1 }, second: { tabs: 4 } });
});

test("a switch that fails reloads nothing, so the page's layout saves count again at once", async () => {
  const sandbox = serviceSandbox();
  const [first, second] = [sandbox.workspace("first"), sandbox.workspace("second")];
  saveSettings(sandbox.settingsFile, { version: 1, workspace: first, workspaces: {}, askOnQuit: true });
  const workspace = control(sandbox, path.join(sandbox.base, "no-such-entry.mjs"));

  await expect(workspace.switchWorkspace(second)).rejects.toThrow();
  workspace.setPageSettings({ layout: { tabs: 1 } });

  expect(layouts(sandbox)).toEqual({ first: { tabs: 1 } });
});
