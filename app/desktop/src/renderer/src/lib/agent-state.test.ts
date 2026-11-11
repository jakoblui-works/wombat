import { expect, test } from "vitest";

import { AGENT_STATE_ORDER, LIST_GROUP_ORDER, listGroup } from "./agent-state.ts";

test("listGroup puts stopped under done and leaves every other state in its own group", () => {
  expect(listGroup("stopped")).toBe("done");
  for (const state of AGENT_STATE_ORDER.filter((s) => s !== "stopped")) expect(listGroup(state)).toBe(state);
});

test("the list's groups are the states in rank order without stopped", () => {
  expect(LIST_GROUP_ORDER).toEqual(["waiting", "working", "done", "error"]);
});
