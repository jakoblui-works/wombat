// Showing an agent expands its overview group, so an agent opened from anywhere (Needs me, a new agent) shows in the
// overview; the user's own collapse of a group still holds.
import { expect, test } from "vitest";

import { summary } from "../../../../../test/summaries.ts";
import { emptyShell } from "../shell/shell-state.ts";
import { collapseGroup, expandShownAgent, isCollapsed } from "./collapsed-groups.ts";

// Invented workspaces and agents.
const BAKERY = "ws-bakery0001";
const GARDEN = "ws-garden0002";
const AGENTS = [summary("agent-1", { workspace: BAKERY }), summary("agent-2", { workspace: GARDEN })];

test("showing an agent of a collapsed group expands that group only, and a group collapsed after stays collapsed", () => {
  const bothCollapsed = collapseGroup(collapseGroup(emptyShell, BAKERY, true), GARDEN, true);

  const shown = expandShownAgent(bothCollapsed, "agent-1", AGENTS);
  expect(isCollapsed(shown, BAKERY)).toBe(false);
  expect(isCollapsed(shown, GARDEN)).toBe(true);

  const collapsedAfter = collapseGroup(shown, BAKERY, true);
  expect(isCollapsed(collapsedAfter, BAKERY)).toBe(true);
  expect(isCollapsed(collapsedAfter, GARDEN)).toBe(true);
});
