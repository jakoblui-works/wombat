// Opening a tab beside another (the diff tab beside its chat), against a fake of the part of dockview's api the tabs
// use, which places panels in groups as dockview does: into the group to the right of the other tab's group, else a
// new group there; an open tab is only focused.
import type { AddPanelOptions, IDockviewPanel } from "dockview-react";
import { expect, test } from "vitest";

import "./activities.ts";
import { revealStore, type TabHost, tabKey, workbenchActions } from "./tabs.ts";

const chat = { viewId: "chat", params: { agentId: "agent-1" } };
const diff = { agentId: "agent-1", requestId: "req-1" };
const diffKey = tabKey("diff", diff);

type Group = { id: string; right?: Group };

/** A dockview of groups in a row, left to right; the chat sits in the first. */
const fakeDock = (groupIds: string[]) => {
  const groups: Group[] = groupIds.map((id) => ({ id }));
  groups.forEach((group, index) => {
    const right = groups[index + 1];
    if (right !== undefined) group.right = right;
  });
  const panels = new Map<string, IDockviewPanel & { group: Group }>();
  const focused: string[] = [];
  const groupFor = (position: AddPanelOptions["position"]): Group => {
    const reference = position !== undefined && "referenceGroup" in position ? position.referenceGroup : undefined;
    const group = groups.find(({ id }) => id === (typeof reference === "string" ? reference : reference?.id));
    if (group === undefined) throw new Error("no reference group");
    if (position !== undefined && "direction" in position && position.direction === "right") {
      // A new group, between the reference and whatever was to its right.
      const added: Group = { id: `new-right-of-${group.id}`, ...(group.right === undefined ? {} : { right: group.right }) };
      group.right = added;
      groups.splice(groups.indexOf(group) + 1, 0, added);
      return added;
    }
    return group;
  };
  const host = {
    getPanel: (id: string) => panels.get(id),
    addPanel: (options: AddPanelOptions) => {
      const panel = { id: options.id, params: options.params, group: groupFor(options.position), api: { setActive: () => focused.push(options.id) } };
      panels.set(options.id, panel as unknown as IDockviewPanel & { group: Group });
      return panel;
    },
    removePanel: (panel: IDockviewPanel) => panels.delete(panel.id),
    get panels() {
      return [...panels.values()];
    },
    activeGroup: groups[0],
    groups,
    adjacentGroupInDirection: (group: Group, direction: string) => (direction === "right" ? group.right : undefined),
  } as unknown as TabHost;
  host.addPanel({ id: tabKey(chat.viewId, chat.params), component: "view", params: chat, position: { referenceGroup: groups[0]?.id ?? "" } });
  const actions = workbenchActions(host, revealStore(), () => ({ agents: undefined }), () => undefined);
  const groupOf = (key: string) => panels.get(key)?.group.id;
  return { actions, focused, groupOf, groupIds: () => groups.map(({ id }) => id), count: () => panels.size };
};

test("beside the chat: a new group to its right, or the group already there", () => {
  const alone = fakeDock(["g1"]);
  alone.actions.openBeside("diff", diff, chat);
  expect(alone.groupIds()).toEqual(["g1", "new-right-of-g1"]);
  expect(alone.groupOf(diffKey)).toBe("new-right-of-g1");

  const withRight = fakeDock(["g1", "g2"]);
  withRight.actions.openBeside("diff", diff, chat);
  expect(withRight.groupIds()).toEqual(["g1", "g2"]);
  expect(withRight.groupOf(diffKey)).toBe("g2");
});

test("an open tab is focused, not opened again", () => {
  const dock = fakeDock(["g1"]);
  dock.actions.openBeside("diff", diff, chat);
  dock.actions.openBeside("diff", diff, chat);
  expect(dock.count()).toBe(2);
  expect(dock.focused).toEqual([diffKey]);
});
