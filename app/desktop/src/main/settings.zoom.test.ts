// Contract "Zoom level in settings": settings.json's top-level zoomLevel (an Electron zoom level, default 0) is main's
// alone, parsed on its own like askOnQuit and clamped to the zoom bounds (main/zoom.ts owns them), so a hand-edited
// or stale value can never open the window at an unusable size.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { expect, onTestFinished, test } from "vitest";

import { loadSettings, saveSettings, settingsPath, type Settings } from "./settings.ts";
import { ZOOM_MAX, ZOOM_MIN } from "./zoom.ts";

/** A settings.json in a fresh user data folder, holding `content` as JSON. */
const settingsFile = (content?: unknown): string => {
  const base = mkdtempSync(path.join(tmpdir(), "wombat-zoom-settings-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const userData = path.join(base, "Wombat");
  mkdirSync(userData);
  const file = settingsPath(userData);
  if (content !== undefined) writeFileSync(file, JSON.stringify(content));
  return file;
};

const quiet = (): undefined => undefined;

// JSON can't tell -0 from 0; a level read back as 0 is the same level.
const level = fc.double({ noNaN: true, noDefaultInfinity: true }).map((value) => (value === 0 ? 0 : value));

test("any saved zoomLevel loads within the zoom bounds: as saved when inside them, the nearest bound when outside", () => {
  expect(ZOOM_MIN).toBeLessThan(0);
  expect(ZOOM_MAX).toBeGreaterThan(0);
  fc.assert(
    fc.property(level, (saved) => {
      const loaded = loadSettings(settingsFile({ version: 1, zoomLevel: saved }), quiet).zoomLevel;
      expect(loaded).toBe(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, saved)));
    }),
    { numRuns: 200 },
  );
});

test("a missing zoomLevel is 0, and one that isn't a number falls back to 0 alone, with a log line naming the field", () => {
  expect(loadSettings(settingsFile(), quiet).zoomLevel).toBe(0);
  expect(loadSettings(settingsFile({ version: 1, askOnQuit: false }), quiet).zoomLevel).toBe(0);

  for (const bad of ["big", "2", true, null, [1], { level: 1 }]) {
    const lines: string[] = [];
    const loaded = loadSettings(settingsFile({ version: 1, askOnQuit: false, lastAgentFolder: "/home/dev/bakery", zoomLevel: bad }), (line) => lines.push(line));
    expect(loaded.zoomLevel, JSON.stringify(bad)).toBe(0);
    expect(loaded.askOnQuit, "another field was lost with the bad zoomLevel").toBe(false);
    expect(loaded.lastAgentFolder).toBe("/home/dev/bakery");
    expect(lines.join("\n")).toContain("zoomLevel");
  }
});

test("a saved zoom level loads back the same, at the top level of settings.json", () => {
  fc.assert(
    fc.property(fc.double({ min: ZOOM_MIN, max: ZOOM_MAX, noNaN: true }).map((value) => (value === 0 ? 0 : value)), (saved) => {
      const file = settingsFile();
      const settings: Settings = { ...loadSettings(file, quiet), zoomLevel: saved };
      saveSettings(file, settings);
      expect((JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)["zoomLevel"]).toBe(saved);
      expect(loadSettings(file, quiet)).toEqual(settings);
    }),
    { numRuns: 50 },
  );
});
