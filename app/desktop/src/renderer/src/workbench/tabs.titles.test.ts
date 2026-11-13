// A tab's title change never arms the layout saver, while a tab the user opened in the same dockview event still does.
import { afterEach, expect, test, vi } from "vitest";

import "./activities.ts";
import { layoutSaver, pageChanges } from "./layout-saver.ts";
import { withoutTitleChanges } from "./tabs.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("a title change never arms the saver; a tab opened in the same dockview event does", () => {
  vi.useFakeTimers();
  const written: unknown[] = [];
  const byThePage = pageChanges();
  const saver = layoutSaver(() => ({}) as never, (layout) => written.push(layout), 10);
  const change = (reasons: string[]) => saver.schedule(byThePage.classify(withoutTitleChanges(new Set(reasons))));

  change(["panelTitle"]);
  vi.advanceTimersByTime(50);
  expect(written).toHaveLength(0);

  change(["structure", "panelTitle"]);
  vi.advanceTimersByTime(50);
  expect(written).toHaveLength(1);
});
