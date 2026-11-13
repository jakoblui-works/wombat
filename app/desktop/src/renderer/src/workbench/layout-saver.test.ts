// The layout is saved once it settles, only after a change the user made when the restore fell back, and never after
// the page starts unloading.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { defaultLayout, type SavedLayout } from "./layout.ts";
import { dockviewChange, LAYOUT_SAVE_DELAY_MS, layoutSaver } from "./layout-saver.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const withActivity = (activity: string): SavedLayout => ({ ...defaultLayout(), activity });

// A restore that fell back leaves the saver unarmed: the saved layout (one a newer app wrote, say) stays.
test("unarmed, passive changes never save; the user's first change does, and passive ones after it", () => {
  const written: SavedLayout[] = [];
  const saver = layoutSaver(() => withActivity("any"), (layout) => written.push(layout));
  saver.schedule("passive");
  vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS * 10);
  expect(written).toHaveLength(0);

  saver.schedule("user");
  vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS);
  saver.schedule("passive");
  vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS);
  expect(written).toHaveLength(2);
});

test("once stopped (the page is unloading), a pending save is dropped and no later one happens", () => {
  const written: SavedLayout[] = [];
  const saver = layoutSaver(() => withActivity("any"), (layout) => written.push(layout));
  saver.schedule("user");
  saver.stop();
  saver.schedule("user");
  vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS * 10);
  expect(written).toEqual([]);
});

test.each<[string[], "user" | "passive"]>([
  [["geometry"], "passive"],
  [["geometry", "structure"], "user"],
  [["activePanel"], "user"],
])("dockview reasons %j are a %s change", (reasons, expected) => {
  expect(dockviewChange(new Set(reasons))).toBe(expected);
});
