// The settings file names the user's folders (version 1) or none (version 2): a log about it never carries its
// content. A bad field costs only itself, and a file this app can't read as its own is kept, not overwritten.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import { loadSettings, rendererSettings, savePageSettings, saveSettings, settingsPath, type Settings, type SettingsV1 } from "./settings.ts";

const tempUserData = (): string => {
  const base = mkdtempSync(path.join(tmpdir(), "wombat-settings-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return path.join(base, "Wombat");
};

const DEFAULTS: Settings = { version: 2, askOnQuit: true, zoomLevel: 0 };
const V1_DEFAULTS: SettingsV1 = { version: 1, workspaces: {}, askOnQuit: true, zoomLevel: 0 };

test("an invalid field falls back to its default alone, with one log line naming the field and not its value", () => {
  const userData = tempUserData();
  const file = settingsPath(userData);
  mkdirSync(userData);
  writeFileSync(file, JSON.stringify({ workspace: "relative/secret-project", askOnQuit: false }));
  const lines: string[] = [];
  expect(loadSettings(file, (line) => lines.push(line))).toEqual({ ...V1_DEFAULTS, askOnQuit: false });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("workspace");
  expect(lines[0]).not.toContain("secret-project");
});

test("saved settings load back the same", () => {
  const file = settingsPath(tempUserData());
  const settings: Settings = { ...DEFAULTS, askOnQuit: false, quitAnswer: "stop", zoomLevel: 1 };
  saveSettings(file, settings);
  expect(loadSettings(file, () => undefined)).toEqual(settings);
});

test.each([
  ["from a newer version", JSON.stringify({ version: 3, workspace: "/home/dev/bakery", panes: ["agents"] })],
  ["that isn't JSON", `{ "version": 1, "workspace": "/home/dev/bakery", oops`],
])("a settings file %s is kept aside as settings.json.bad, byte for byte, never rewritten as this version", (_name, content) => {
  const userData = tempUserData();
  const file = settingsPath(userData);
  mkdirSync(userData);
  writeFileSync(file, content);
  expect(loadSettings(file, () => undefined)).toEqual(DEFAULTS);
  expect(readFileSync(`${file}.bad`, "utf8")).toBe(content);
  expect(existsSync(file)).toBe(false);
});

test("the page sees and sets only askOnQuit, lastAgentFolder and layout; only askOnQuit is saved", () => {
  const saved: Settings[] = [];
  let settings: Settings = DEFAULTS;
  const update = (change: (current: Settings) => Settings) => {
    settings = change(settings);
    saved.push(settings);
  };

  const memory = savePageSettings(update, {}, { askOnQuit: false, lastAgentFolder: "bakery-site", layout: { panes: 3 } });
  expect(saved).toEqual([{ ...DEFAULTS, askOnQuit: false }]);
  expect(rendererSettings(settings, memory)).toEqual({ askOnQuit: false, lastAgentFolder: "bakery-site", layout: { panes: 3 } });

  expect(() => savePageSettings(update, memory, { workspace: "/home/dev/other" })).toThrow(/askOnQuit, lastAgentFolder and layout/);
  // A layout that couldn't be held as JSON is refused, so it can't block later reads.
  expect(() => savePageSettings(update, memory, { layout: { panes: 10n } })).toThrow(/settings change isn't valid/);
});

test("one workspace's relative itemsRoot in a version 1 file costs only itself: the other workspaces and that workspace's layout stay", () => {
  const userData = tempUserData();
  const file = settingsPath(userData);
  mkdirSync(userData);
  writeFileSync(
    file,
    JSON.stringify({
      workspace: "/home/dev/bakery",
      workspaces: {
        "/home/dev/bakery": { itemsRoot: "relative/secret-docs", layout: { panes: 2 } },
        "/home/dev/other": { itemsRoot: "/home/dev/other/docs" },
      },
    }),
  );
  const lines: string[] = [];
  expect(loadSettings(file, (line) => lines.push(line))).toEqual({
    ...V1_DEFAULTS,
    workspace: "/home/dev/bakery",
    workspaces: { "/home/dev/bakery": { layout: { panes: 2 } }, "/home/dev/other": { itemsRoot: "/home/dev/other/docs" } },
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("itemsRoot");
  expect(lines[0]).not.toContain("secret-docs");
  expect(lines[0]).not.toContain("/home/dev/bakery");
});
