// The workspace control's settings: a save that fails changes nothing, and a version 1 file keeps its folders until
// they're handed over. Dialogs are injected; only the fake service starts.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import { writePrivateFile } from "@wombat/shared/private-file";

import { savePageSettings } from "./settings.ts";
import { FAKE_SERVICE_ENTRY, serviceSandbox } from "../../test/service-sandbox.ts";
import { workspaceControl } from "./workspace.ts";

test("a page's settings change whose save fails leaves the settings as they were, and the page's error names no path", () => {
  const sandbox = serviceSandbox();
  // The settings folder's place is taken by a file, so every save fails (naming the path).
  const blocked = path.join(sandbox.base, "blocked");
  writeFileSync(blocked, "");
  const workspace = workspaceControl({
    env: sandbox.env,
    settingsFile: path.join(blocked, "settings.json"),
    serviceEntry: FAKE_SERVICE_ENTRY,
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    log: () => undefined,
  });
  const before = workspace.settings();
  const logged: string[] = [];

  let pageError: unknown;
  try {
    savePageSettings(workspace.updateSettings, {}, { askOnQuit: false }, (line) => logged.push(line));
  } catch (error) {
    pageError = error;
  }

  expect(pageError).toBeInstanceOf(Error);
  expect((pageError as Error).message).not.toContain(sandbox.base);
  expect(logged.join("\n"), "main's log keeps the reason").toContain(blocked);
  expect(workspace.settings()).toEqual(before);
});

// While the open workspace's folder is gone, its stored agents wait for an adopting add: a version 2 file would lose
// the folder that add needs.
test("a version 1 file whose open folder is gone stays at version 1 through the upgrade and through page saves before and after it", async () => {
  const sandbox = serviceSandbox();
  const bakery = sandbox.workspace("bakery");
  const other = sandbox.workspace("other");
  writePrivateFile(sandbox.settingsFile, JSON.stringify({ version: 1, workspace: bakery, workspaces: { [bakery]: {}, [other]: {} } }));
  const workspace = workspaceControl({
    env: sandbox.env,
    settingsFile: sandbox.settingsFile,
    serviceEntry: FAKE_SERVICE_ENTRY,
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    usable: (at) => at !== bakery,
    log: () => undefined,
  });
  const onDisk = () => JSON.parse(readFileSync(sandbox.settingsFile, "utf8")) as { version: number; workspace?: string; askOnQuit: boolean };

  workspace.setPageSettings({ askOnQuit: false });
  expect(onDisk(), "a page save while the upgrade is pending").toMatchObject({ version: 1, workspace: bakery, askOnQuit: false });

  await workspace.prepare(await (await workspace.open()).service);
  expect(onDisk(), "the upgrade with the open folder gone").toMatchObject({ version: 1, workspace: bakery });

  workspace.setPageSettings({ askOnQuit: true });
  expect(onDisk(), "a page save after that upgrade").toMatchObject({ version: 1, workspace: bakery, askOnQuit: true });
});
