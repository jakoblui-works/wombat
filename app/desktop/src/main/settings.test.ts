// The settings file names the user's folders: a log about it never carries its content. A bad field costs only
// itself, and a file this app can't read as its own is kept, not overwritten.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import {
  loadSettings,
  rendererSettings,
  saveSettings,
  settingsPath,
  withRendererPatch,
  type Settings,
} from "./settings.ts";

const tempUserData = (): string => {
  const base = mkdtempSync(path.join(tmpdir(), "wombat-settings-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return path.join(base, "Wombat");
};

const DEFAULTS: Settings = { version: 1, workspaces: {}, askOnQuit: true, zoomLevel: 0 };

test("an invalid field falls back to its default alone, with one log line naming the field and not its value", () => {
  const userData = tempUserData();
  const file = settingsPath(userData);
  mkdirSync(userData);
  writeFileSync(file, JSON.stringify({ workspace: "relative/secret-project", askOnQuit: false }));
  const lines: string[] = [];
  expect(loadSettings(file, (line) => lines.push(line))).toEqual({ ...DEFAULTS, askOnQuit: false });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("workspace");
  expect(lines[0]).not.toContain("secret-project");
});

test("saved settings load back the same", () => {
  const file = settingsPath(tempUserData());
  const settings: Settings = { ...DEFAULTS, workspace: "/home/dev/bakery", workspaces: { "/home/dev/bakery": { itemsRoot: "/home/dev/docs" } } };
  saveSettings(file, settings);
  expect(loadSettings(file, () => undefined)).toEqual(settings);
});

test.each([
  ["from a newer version", JSON.stringify({ version: 2, workspace: "/home/dev/bakery", panes: ["agents"] })],
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

test("the page sees and sets only askOnQuit, lastAgentFolder and the current workspace's layout", () => {
  const settings: Settings = {
    ...DEFAULTS,
    workspace: "/home/dev/bakery",
    workspaces: { "/home/dev/bakery": { itemsRoot: "/home/dev/bakery/docs", layout: { panes: 2 } }, "/home/dev/other": { layout: { panes: 5 } } },
  };
  expect(rendererSettings(settings)).toEqual({ askOnQuit: true, layout: { panes: 2 } });

  const next = withRendererPatch(settings, { askOnQuit: false, layout: { panes: 3 } });
  expect(next.askOnQuit).toBe(false);
  expect(next.workspaces).toEqual({
    "/home/dev/bakery": { itemsRoot: "/home/dev/bakery/docs", layout: { panes: 3 } },
    "/home/dev/other": { layout: { panes: 5 } },
  });
  expect(() => withRendererPatch(settings, { workspace: "/home/dev/other" })).toThrow(/askOnQuit, lastAgentFolder and layout/);
  // A layout that couldn't be written as JSON is refused, so it can't block later saves.
  expect(() => withRendererPatch(settings, { layout: { panes: 10n } })).toThrow(/settings change isn't valid/);
});

test("one workspace's relative itemsRoot costs only itself: the other workspaces and that workspace's layout stay", () => {
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
    ...DEFAULTS,
    workspace: "/home/dev/bakery",
    workspaces: { "/home/dev/bakery": { layout: { panes: 2 } }, "/home/dev/other": { itemsRoot: "/home/dev/other/docs" } },
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("itemsRoot");
  expect(lines[0]).not.toContain("secret-docs");
  expect(lines[0]).not.toContain("/home/dev/bakery");
});
