// The workspace control's settings: a save that fails changes nothing. Dialogs are injected; nothing starts a service.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

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
