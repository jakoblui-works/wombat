// An empty split, against a fake of the part of dockview's api splitEmpty uses, and the view.split.* commands that
// call it: each direction puts a new, active group on that side of the reference group.
import type { AddGroupOptions, DockviewGroupPanel } from "dockview-react";
import { afterEach, expect, test } from "vitest";

import { runCommand } from "./commands/registry.ts";
import { registerWorkbenchCommands } from "./commands/workbench-commands.ts";
import { type SplitDirection, splitEmpty, type TabHost } from "./tabs.ts";

type Added = { id: string; options: Extract<AddGroupOptions, { referenceGroup: unknown }> | undefined };

const fakeDock = (groupIds: string[], active: string) => {
  const groups = groupIds.map((id) => ({ id }));
  const added: Added[] = [];
  const activated: string[] = [];
  const host = {
    groups,
    get activeGroup() {
      return groups.find(({ id }) => id === active);
    },
    addGroup: (options?: Added["options"]) => {
      const id = `new-${String(added.length)}`;
      added.push({ id, options });
      return { id, api: { setActive: () => activated.push(id) } } as unknown as DockviewGroupPanel;
    },
    getPanel: (id: string) => (id === "tab-in-g2" ? { group: groups[1] } : undefined),
  };
  return { host: host as unknown as TabHost, added, activated };
};

const DIRECTIONS: [SplitDirection, string][] = [
  ["right", "right"],
  ["down", "below"],
  ["left", "left"],
  ["up", "above"],
];

test.each(DIRECTIONS)("splitEmpty %s adds an active group on that side of the active group", (direction, side) => {
  const { host, added, activated } = fakeDock(["g1", "g2"], "g2");
  splitEmpty(host, direction, undefined);
  expect(added.map(({ options }) => options)).toEqual([{ referenceGroup: host.groups[1], direction: side }]);
  expect(activated).toEqual(["new-0"]);
});

test("splitEmpty splits the group it is given, not the active one", () => {
  const { host, added } = fakeDock(["g1", "g2"], "g2");
  splitEmpty(host, "right", "g1");
  expect(added[0]?.options?.referenceGroup).toBe(host.groups[0]);
});

test("splitEmpty for a group that isn't there says so and adds nothing", () => {
  const { host, added } = fakeDock(["g1"], "g1");
  expect(() => splitEmpty(host, "right", "gone")).toThrow(/no group "gone"/);
  expect(added).toEqual([]);
});

let unregister: (() => void) | undefined;
afterEach(() => unregister?.());

const withCommands = (dock: ReturnType<typeof fakeDock>) => {
  unregister = registerWorkbenchCommands({
    api: () => dock.host as never,
    activities: [],
    showActivity: () => undefined,
    toggleRightSidebar: () => undefined,
    blocked: () => false,
  });
};

test("view.split.<direction> maps to splitEmpty: the active group by default, the target's group when given", async () => {
  const dock = fakeDock(["g1", "g2"], "g1");
  withCommands(dock);
  await runCommand("view.split.down");
  await runCommand("view.split.up", { groupId: "g2" });
  expect(dock.added.map(({ options }) => [options?.referenceGroup, options?.direction])).toEqual([
    [dock.host.groups[0], "below"],
    [dock.host.groups[1], "above"],
  ]);
});

test("a split from a tab's context menu takes the tab's group even when another group is active", async () => {
  const dock = fakeDock(["g1", "g2"], "g1");
  withCommands(dock);
  await runCommand("view.split.left", { panelId: "tab-in-g2" });
  expect(dock.added[0]?.options?.referenceGroup).toBe(dock.host.groups[1]);
});

test("Close from a tab's context menu closes that tab, not the active one", async () => {
  const removed: string[] = [];
  const panels = { clicked: { id: "clicked" }, active: { id: "active" } };
  const dock = {
    activePanel: panels.active,
    getPanel: (id: string) => (id === "clicked" ? panels.clicked : undefined),
    removePanel: (panel: { id: string }) => removed.push(panel.id),
  };
  unregister = registerWorkbenchCommands({
    api: () => dock as never,
    activities: [],
    showActivity: () => undefined,
    toggleRightSidebar: () => undefined,
    blocked: () => false,
  });
  await runCommand("view.closeTab", { groupId: "g2", panelId: "clicked" });
  expect(removed).toEqual(["clicked"]);
});

type FakeGroup = { id: string; panels: object[]; activePanel?: object };

const closeDock = (groups: FakeGroup[], active: string) => {
  const removed: string[] = [];
  const dock = {
    groups,
    get activeGroup() {
      return groups.find(({ id }) => id === active);
    },
    get activePanel() {
      return this.activeGroup?.activePanel;
    },
    getGroup: (id: string) => groups.find((group) => group.id === id),
    getPanel: () => undefined,
    removePanel: () => removed.push("panel"),
    removeGroup: (group: FakeGroup) => removed.push(group.id),
  };
  unregister = registerWorkbenchCommands({ api: () => dock as never, activities: [], showActivity: () => undefined, toggleRightSidebar: () => undefined, blocked: () => false });
  return removed;
};

test("Close Tab (Ctrl+W) closes the active group when it has no tab", async () => {
  const removed = closeDock([{ id: "g1", panels: [{}] }, { id: "empty", panels: [] }], "empty");
  await runCommand("view.closeTab");
  expect(removed).toEqual(["empty"]);
});

test("Close from an empty group's own target closes that group, not the active one", async () => {
  const removed = closeDock([{ id: "g1", panels: [{}] }, { id: "empty", panels: [] }, { id: "other", panels: [] }], "g1");
  await runCommand("view.closeTab", { groupId: "empty" });
  expect(removed).toEqual(["empty"]);
});

test("Close Tab never closes the last group, empty or not", async () => {
  const removed = closeDock([{ id: "only", panels: [] }], "only");
  await runCommand("view.closeTab");
  expect(removed).toEqual([]);
});

test("Close Tab leaves a group that still has tabs to its tab", async () => {
  const tab = {};
  const removed = closeDock([{ id: "g1", panels: [tab], activePanel: tab }, { id: "g2", panels: [] }], "g1");
  await runCommand("view.closeTab");
  expect(removed).toEqual(["panel"]);
});
