// The workbench's actions views call (useWorkbench()), against a fake of the part of dockview's api the tabs use.
import type { AddPanelOptions, IDockviewPanel } from "dockview-react";
import { expect, test } from "vitest";

import "./activities.ts";
import { revealStore, type TabHost, tabKey, workbenchActions } from "./tabs.ts";

/** A dockview with one group, holding the panels added and not removed. */
const fakeDock = () => {
  const panels = new Map<string, IDockviewPanel>();
  const group = { id: "g1" };
  const host = {
    getPanel: (id: string) => panels.get(id),
    addPanel: (options: AddPanelOptions) => {
      const panel = { id: options.id, title: options.title, params: options.params, api: { setActive: () => undefined } } as unknown as IDockviewPanel;
      panels.set(options.id, panel);
      return panel;
    },
    removePanel: (panel: IDockviewPanel) => panels.delete(panel.id),
    get panels() {
      return [...panels.values()];
    },
    activeGroup: group,
    groups: [group],
  } as unknown as TabHost;
  return { host, open: () => [...panels.keys()] };
};

const setup = () => {
  const dock = fakeDock();
  const reveals = revealStore();
  const actions = workbenchActions(dock.host, reveals, () => ({ agents: undefined }), () => undefined);
  return { ...dock, reveals, actions };
};

test("closeTab closes the tab for that view and params, and nothing else", () => {
  const { actions, open } = setup();
  actions.openTab("chat", { agentId: "a1" });
  actions.openTab("chat", { agentId: "a2" });

  actions.closeTab("chat", { agentId: "a1" });
  actions.closeTab("chat", { agentId: "a-never-opened" });

  expect(open()).toEqual([tabKey("chat", { agentId: "a2" })]);
});

test("a reveal reaches the tab already open for that view and params, without a second tab, each time it's asked", () => {
  const { actions, reveals, open } = setup();
  const key = tabKey("chat", { agentId: "a1" });
  actions.openTab("chat", { agentId: "a1" });
  let notified = 0;
  reveals.subscribe(() => (notified += 1));

  actions.openTab("chat", { agentId: "a1" }, "request-7");
  const first = reveals.get(key);
  actions.openTab("chat", { agentId: "a1" }, "request-7");

  expect(open()).toEqual([key]);
  expect(reveals.get(key)?.target).toBe("request-7");
  expect(reveals.get(key), "asked twice, revealed twice").not.toBe(first);
  expect(notified).toBe(2);
});
