// S7 T15 (silent failure): opening an agent at a request, the one path for a Needs me click and a notification
// click. `openAgentChat(agentId, requestId?)` switches to Agents, opens or focuses the agent's chat tab and reveals
// the request; without one it reveals the agent's oldest pending permission (smallest `at`, ties by list order), and
// with none pending it opens the chat with nothing to reveal. Against a fake of the part of dockview's api the tabs
// use, as in tabs.actions.test.ts.
import type { AddPanelOptions, IDockviewPanel } from "dockview-react";
import { expect, test } from "vitest";

import type { AgentSummary } from "@wombat/shared/api";

import { atFor } from "../../../../../shared/test/log-entries.ts";
import { summary } from "../../../../test/summaries.ts";
// Registers the views (the chat tab opens through the registry).
import "./activities.ts";
import { AGENTS_ACTIVITY } from "./activity-ids.ts";
import type { ResolveContext } from "./registry.ts";
import { revealStore, type TabHost, tabKey, workbenchActions } from "./tabs.ts";

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

const pending = (requestId: string, at: string): AgentSummary["pendingPermissions"][number] => ({ requestId, at, title: `Asks ${requestId}`, kind: "edit" });

const AGENTS = [
  // The latest first, then two equally old ones: the first of those listed is the oldest. Their ids sort the other
  // way round, so an order by id would pick the wrong one.
  summary("agent-asks", { state: "waiting", pendingPermissions: [pending("req-late", atFor(30)), pending("req-z-first", atFor(10)), pending("req-a-second", atFor(10))] }),
  summary("agent-quiet", { state: "done" }),
];

const setup = () => {
  const dock = fakeDock();
  const reveals = revealStore();
  const shown: string[] = [];
  const ctx = (): ResolveContext => ({ agents: AGENTS });
  // The activity setter is the workbench's own seam (interface-S7, Decisions); the fake records what it was asked.
  const actions = workbenchActions(dock.host, reveals, ctx, (activity: string) => shown.push(activity));
  const openAgentChat = (actions as { openAgentChat?: (agentId: string, requestId?: string) => void }).openAgentChat;
  expect(typeof openAgentChat, "WorkbenchActions has no openAgentChat").toBe("function");
  return { ...dock, reveals, shown, openAgentChat: openAgentChat as (agentId: string, requestId?: string) => void };
};

const chatKey = (agentId: string) => tabKey("chat", { agentId });

test("without a request: Agents, the agent's chat, and its oldest pending permission revealed", () => {
  const { openAgentChat, open, reveals, shown } = setup();
  openAgentChat("agent-asks");
  expect(shown.at(-1)).toBe(AGENTS_ACTIVITY);
  expect(open()).toEqual([chatKey("agent-asks")]);
  expect(reveals.get(chatKey("agent-asks"))?.target).toBe("req-z-first");
});

test("with a request: that one is revealed, on the same tab, each time it's asked", () => {
  const { openAgentChat, open, reveals } = setup();
  openAgentChat("agent-asks", "req-late");
  const first = reveals.get(chatKey("agent-asks"));
  openAgentChat("agent-asks", "req-late");
  const second = reveals.get(chatKey("agent-asks"));
  expect(open()).toEqual([chatKey("agent-asks")]);
  expect(second?.target).toBe("req-late");
  expect(second, "a second ask must reach the view again").not.toBe(first);
});

test("an agent with nothing pending: its chat opens, nothing to reveal", () => {
  const { openAgentChat, open, reveals, shown } = setup();
  openAgentChat("agent-quiet");
  expect(shown.at(-1)).toBe(AGENTS_ACTIVITY);
  expect(open()).toEqual([chatKey("agent-quiet")]);
  expect(reveals.get(chatKey("agent-quiet"))).toBeUndefined();
});
