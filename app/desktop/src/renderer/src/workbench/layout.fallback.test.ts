// The restore says when it fell back to the default although a layout was saved: the saver must then leave the saved
// layout alone until the user changes something.
import { expect, test, vi } from "vitest";

import "./activities.ts";
import { defaultLayout, restoreLayout } from "./layout.ts";

const tab = { id: 'chat:{"agentId":"a1"}', contentComponent: "view", title: "chat", params: { viewId: "chat", params: { agentId: "a1" } } };
const versionOne = {
  version: 1,
  dockview: {
    grid: { root: { type: "branch", data: [{ type: "leaf", data: { id: "editor", views: [tab.id], activeView: tab.id }, size: 0 }], size: 0 }, width: 0, height: 0, orientation: "HORIZONTAL" },
    panels: { [tab.id]: tab },
  },
  sidebars: { left: 280, right: 296, rightCollapsed: true },
  activity: "agents",
};

test.each<[string, unknown, boolean]>([
  ["a version 1 layout", versionOne, true],
  ["nothing saved yet", undefined, false],
  ["a layout that restores", defaultLayout(), false],
])("%s: onFallback called is %s", (_name, raw, expected) => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let fellBack = false;
  restoreLayout(raw, () => true, () => undefined, () => {
    fellBack = true;
  });
  expect(fellBack).toBe(expected);
  vi.restoreAllMocks();
});
