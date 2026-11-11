// An id names one view and one activity: registering it again is a mistake that must show at start-up.
import { Square } from "lucide-react";
import { expect, test } from "vitest";

import { registerActivity, registerView } from "./registry.ts";

test("registering a view or an activity id twice throws", () => {
  const view = { id: "twice-view", title: "Twice", icon: Square, locations: ["left" as const], component: () => null };
  registerView(view);
  expect(() => registerView({ ...view, title: "Again" })).toThrow(/twice-view/);

  const activity = { id: "twice-activity", title: "Twice", icon: Square, sidebarView: "twice-view" };
  registerActivity(activity);
  expect(() => registerActivity(activity)).toThrow(/twice-activity/);
});
