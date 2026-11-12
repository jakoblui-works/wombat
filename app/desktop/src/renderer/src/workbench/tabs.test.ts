// A tab's identity and opening a tab, against a fake of the part of dockview's api openTab uses.
import type { AddPanelOptions } from "dockview-react";
import { expect, test } from "vitest";

import "./activities.ts";
import { openTab, type TabHost, tabKey } from "./tabs.ts";

test("tabKey is the same whatever order the params' keys are in, and differs for different params", () => {
  expect(tabKey("chat", { agentId: "a1", at: { line: 3, col: 1 } })).toBe(tabKey("chat", { at: { col: 1, line: 3 }, agentId: "a1" }));
  expect(tabKey("chat", { agentId: "a1" })).not.toBe(tabKey("chat", { agentId: "a2" }));
  expect(tabKey("chat", { agentId: "a1" })).not.toBe(tabKey("files-empty", { agentId: "a1" }));
});

/** A dockview with one group: the panels added to it, in order, and which one was focused last. */
const fakeDock = () => {
  const added: string[] = [];
  const state = { focused: "" };
  const group = { id: "g1" };
  const host = {
    getPanel: (id: string) => (added.includes(id) ? { api: { setActive: () => void (state.focused = id) } } : undefined),
    addPanel: (options: AddPanelOptions) => {
      added.push(options.id);
      state.focused = options.id;
      return {};
    },
    activeGroup: group,
    groups: [group],
  } as unknown as TabHost;
  return { host, added, state };
};

test("opening a tab that's already open focuses it instead of adding a second", () => {
  const { host, added, state } = fakeDock();
  openTab(host, "chat", { agentId: "a1" });
  openTab(host, "chat", { agentId: "a2" });
  openTab(host, "chat", { agentId: "a1" });

  expect(added).toEqual([tabKey("chat", { agentId: "a1" }), tabKey("chat", { agentId: "a2" })]);
  expect(state.focused).toBe(tabKey("chat", { agentId: "a1" }));
});

test("opening a tab with params its view's schema refuses throws, and adds nothing", () => {
  const { host, added } = fakeDock();
  expect(() => openTab(host, "chat", { agentId: 7 })).toThrow(/chat/);
  expect(added).toEqual([]);
});
