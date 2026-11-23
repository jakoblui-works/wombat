// When the shell is written to settings.json: not for the shell the restore gave, and once after a change settles.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import "../activities.ts";
import { DESK_ACTIVITY } from "../activity-ids.ts";
import { isSaved } from "../registry.ts";
import { SHELL_SAVE_DELAY_MS, shellSaver } from "./shell-saver.ts";
import { openAgent, pressToolbarButton, restoredShell, type SavedShell, savedShell } from "./shell-state.ts";

// Invented: a shell saved by the last run, with an open agent and the Desk open in one workspace.
const BAKERY = "ws-bakery0001";
const LAST_RUN = {
  openAgent: "agent-oven-1",
  leftHidden: true,
  workspaces: { [BAKERY]: { tabs: [], activity: DESK_ACTIVITY, navigatorHidden: false, rightOpen: true, activityStates: { [DESK_ACTIVITY]: { openDrawers: ["recipes"] } } } },
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("the restored shell is never written; a change is written once, after the delay", () => {
  const shell = restoredShell(LAST_RUN, () => true);
  const restored = savedShell(shell, isSaved);
  const written: SavedShell[] = [];
  const saver = shellSaver(restored, (saved) => written.push(saved));

  // The shell as restored, offered again as each render does.
  saver.offer(savedShell(shell, isSaved));
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS * 3);
  saver.offer(savedShell(shell, isSaved));
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS * 3);
  expect(written, "the restored shell was written").toEqual([]);

  const changed = savedShell(pressToolbarButton(openAgent(shell, "agent-oven-2"), BAKERY, DESK_ACTIVITY), isSaved);
  saver.offer(changed);
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS - 1);
  expect(written, "written before the delay").toEqual([]);
  vi.advanceTimersByTime(1);
  expect(written).toEqual([changed]);

  saver.offer(changed);
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS * 3);
  expect(written, "the same shell written again").toHaveLength(1);
});

test("a flush on quit writes a waiting save at once, nothing when none waits, and nothing offered after it", () => {
  const shell = restoredShell(LAST_RUN, () => true);
  const restored = savedShell(shell, isSaved);
  const changed = savedShell(pressToolbarButton(openAgent(shell, "agent-oven-2"), BAKERY, DESK_ACTIVITY), isSaved);
  const start = () => {
    const written: SavedShell[] = [];
    return { written, saver: shellSaver(restored, (saved) => written.push(saved)) };
  };

  // Changed just before the quit: written without waiting for the delay.
  const quit = start();
  quit.saver.offer(changed);
  quit.saver.flush();
  expect(quit.written, "the waiting save on flush").toEqual([changed]);
  quit.saver.offer(restored);
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS * 3);
  expect(quit.written, "an offer after the flush was written").toEqual([changed]);

  // Nothing waits: never changed, changed and back to the restored shell, or already saved.
  const untouched = start();
  untouched.saver.flush();
  const changedBack = start();
  changedBack.saver.offer(changed);
  changedBack.saver.offer(restored);
  changedBack.saver.flush();
  const saved = start();
  saved.saver.offer(changed);
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS);
  saved.saver.offer(changed);
  saved.saver.flush();
  vi.advanceTimersByTime(SHELL_SAVE_DELAY_MS * 3);
  expect([untouched.written, changedBack.written, saved.written], "written when no save waited").toEqual([[], [], [changed]]);
});
