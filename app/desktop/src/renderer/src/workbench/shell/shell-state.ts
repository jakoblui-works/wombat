// The shell's state: which agent is open, which workspace is shown, and each workspace's right sidebar.
import type { AgentSummary, Workspace } from "@wombat/shared/api";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import { getPanel } from "../registry.ts";
import { tabKey, tabToReplace } from "../tabs.ts";
import type { TabRef } from "../workbench-context.ts";

export type TabEntry = TabRef & { kept: boolean };

export type WorkspaceShell = {
  tabs: TabEntry[];
  /** The active tab's key. */
  active?: string;
  activity?: string;
  navigatorHidden: boolean;
  rightOpen: boolean;
  activityStates: Record<string, unknown>;
  /** Each activity's last active tab, by activity id. */
  lastActive?: Record<string, string>;
  /** The right sidebar's width evidence; never saved. */
  right: RightWidthEvidence;
};

export type RightWidthEvidence = { width?: number; dragged: boolean };

export type ShellState = {
  /** None: the empty new-agent chat. */
  openAgent?: string;
  /** The composer bar's pick while no agent is open. */
  newChatWorkspace?: string;
  leftHidden: boolean;
  barCollapsed: boolean;
  workspaces: Record<string, WorkspaceShell>;
};

export type WidthBounds = { min: number; max: number };

export const LEFT_WIDTH: WidthBounds = { min: 160, max: 800 };
export const LEFT_START_WIDTH = 280;
export const RIGHT_WIDTH: WidthBounds = { min: 240, max: 1200 };
export const CHAT_MIN_WIDTH = 360;

export const emptyShell: ShellState = { leftHidden: false, barCollapsed: false, workspaces: {} };

const emptyWorkspace: WorkspaceShell = { tabs: [], navigatorHidden: false, rightOpen: false, activityStates: {}, right: { dragged: false } };

const keyOf = (tab: TabRef): string => tabKey(tab.panelId, tab.params);

const omit = <T extends object, K extends keyof T>(value: T, ...fields: K[]): Omit<T, K> =>
  Object.fromEntries(Object.entries(value).filter(([field]) => !fields.includes(field as K))) as Omit<T, K>;

/** The toolbar activity a tab belongs to, from its panel's registration; Agents is no toolbar activity. */
export const tabActivity = (panelId: string): string | undefined => {
  const activity = getPanel(panelId)?.activity;
  return activity === AGENTS_ACTIVITY ? undefined : activity;
};

const activeTab = (shell: WorkspaceShell): TabEntry | undefined => shell.tabs.find((tab) => keyOf(tab) === shell.active);

const workspaceShell = (state: ShellState, workspace: string): WorkspaceShell => state.workspaces[workspace] ?? emptyWorkspace;

const withWorkspace = (state: ShellState, workspace: string, change: (shell: WorkspaceShell) => WorkspaceShell): ShellState => {
  const before = workspaceShell(state, workspace);
  const changed = change(before);
  const shell = before.rightOpen && !changed.rightOpen ? { ...changed, right: { dragged: false } } : changed;
  return { ...state, workspaces: { ...state.workspaces, [workspace]: shell } };
};

/** The shown workspace's id: the open agent's, else the composer bar's pick, else the first listed; undefined while the open agent's isn't known yet. */
export const shownWorkspace = (
  state: ShellState,
  agents: readonly Pick<AgentSummary, "id" | "workspace">[] | undefined,
  workspaces?: readonly Pick<Workspace, "id">[],
): string | undefined => {
  if (state.openAgent !== undefined) {
    if (agents === undefined) return undefined;
    const agent = agents.find(({ id }) => id === state.openAgent);
    if (agent !== undefined) return agent.workspace;
  }
  const picked = state.newChatWorkspace;
  if (picked !== undefined && (workspaces === undefined || workspaces.some(({ id }) => id === picked))) return picked;
  return workspaces?.[0]?.id;
};

export const openAgent = (state: ShellState, agentId: string): ShellState => ({ ...omit(state, "newChatWorkspace"), openAgent: agentId });

export const newChat = (state: ShellState, workspace: string | undefined): ShellState => {
  const rest = omit(state, "openAgent", "newChatWorkspace");
  return workspace === undefined ? rest : { ...rest, newChatWorkspace: workspace };
};

/** After `agentId` was deleted: the empty chat on its workspace if it was the open agent, so that workspace stays shown. */
export const agentDeleted = (state: ShellState, agentId: string, workspace: string | undefined): ShellState =>
  state.openAgent === agentId ? newChat(state, workspace) : state;

export type MiddleView = { show: "chat"; agentId: string } | { show: "empty" };

/** What the middle shows: the open agent's chat (also while the agents list isn't read), else the empty chat. */
export const middleView = (state: ShellState, agents: readonly Pick<AgentSummary, "id">[] | undefined): MiddleView => {
  const agentId = state.openAgent;
  if (agentId === undefined || (agents !== undefined && !agents.some(({ id }) => id === agentId))) return { show: "empty" };
  return { show: "chat", agentId };
};

const focus = (shell: WorkspaceShell, key: string): WorkspaceShell => {
  const tab = shell.tabs.find((entry) => keyOf(entry) === key);
  if (tab === undefined) return shell;
  const activity = tabActivity(tab.panelId);
  return {
    ...shell,
    active: key,
    rightOpen: true,
    ...(activity === undefined ? {} : { activity, lastActive: { ...shell.lastActive, [activity]: key } }),
  };
};

/** The tab a temporary open replaces: the workspace's temporary tab, unless it has unsaved edits. */
const replaceable = (shell: WorkspaceShell, isDirty: (key: string) => boolean): number => {
  const tabs = shell.tabs.map((tab) => ({ key: keyOf(tab), temporary: !tab.kept, unsaved: isDirty(keyOf(tab)) }));
  const replaced = tabToReplace(tabs);
  return tabs.findIndex(({ key }) => key === replaced);
};

export type OpenTabOptions = { temporary: boolean; isDirty?: ((key: string) => boolean) | undefined };

/** Opens or activates the tab in `workspace`'s strip and opens its right sidebar on it; a kept open keeps a temporary tab. */
export const openTab = (state: ShellState, workspace: string, tab: TabRef, { temporary, isDirty = () => false }: OpenTabOptions): ShellState =>
  withWorkspace(state, workspace, (shell) => {
    const key = keyOf(tab);
    const entry: TabEntry = { panelId: tab.panelId, params: tab.params, kept: !temporary };
    if (shell.tabs.some((open) => keyOf(open) === key)) {
      return focus({ ...shell, tabs: shell.tabs.map((open) => (keyOf(open) === key && !temporary ? { ...open, kept: true } : open)) }, key);
    }
    const replaced = temporary ? replaceable(shell, isDirty) : -1;
    const tabs = replaced === -1 ? [...shell.tabs, entry] : shell.tabs.map((open, index) => (index === replaced ? entry : open));
    return focus({ ...shell, tabs }, key);
  });

export const keepTab = (state: ShellState, workspace: string, key: string): ShellState =>
  withWorkspace(state, workspace, (shell) => ({ ...shell, tabs: shell.tabs.map((tab) => (keyOf(tab) === key ? { ...tab, kept: true } : tab)) }));

export const activateTab = (state: ShellState, workspace: string, key: string): ShellState => withWorkspace(state, workspace, (shell) => focus(shell, key));

/**
 * Closes the tab; an active one hands over to its neighbour. With no tab left the sidebar stays open on the closed
 * tab's activity's navigator, or closes for a tab without one.
 */
export const closeTab = (state: ShellState, workspace: string, key: string): ShellState =>
  withWorkspace(state, workspace, (shell) => {
    const index = shell.tabs.findIndex((tab) => keyOf(tab) === key);
    const closed = shell.tabs[index];
    if (closed === undefined) return shell;
    const tabs = shell.tabs.filter((_, at) => at !== index);
    const lastActive = Object.fromEntries(Object.entries(shell.lastActive ?? {}).filter(([, last]) => last !== key));
    if (shell.active !== key) return { ...shell, tabs, lastActive };
    const rest = omit({ ...shell, tabs, lastActive }, "active");
    const neighbour = tabs[index] ?? tabs[index - 1];
    if (neighbour !== undefined) return focus(rest, keyOf(neighbour));
    const activity = tabActivity(closed.panelId);
    return activity === undefined ? { ...rest, rightOpen: false } : { ...rest, activity };
  });

/** The activity's last active tab still open, else its last tab in the strip. */
const lastTabOf = (shell: WorkspaceShell, activity: string): string | undefined => {
  const keys = shell.tabs.filter((tab) => tabActivity(tab.panelId) === activity).map(keyOf);
  const last = shell.lastActive?.[activity];
  return last !== undefined && keys.includes(last) ? last : keys.at(-1);
};

/** The toolbar button shown pressed: the active tab's activity, else the sidebar's; none while the sidebar is closed. */
export const activeToolbarButton = (state: ShellState, workspace: string): string | undefined => {
  const shell = workspaceShell(state, workspace);
  if (!shell.rightOpen) return undefined;
  const tab = activeTab(shell);
  return tab === undefined ? shell.activity : tabActivity(tab.panelId);
};

/** The pressed button closes the sidebar; any other opens it on that activity's last active tab, or its navigator alone. */
export const pressToolbarButton = (state: ShellState, workspace: string, activityId: string): ShellState => {
  if (activeToolbarButton(state, workspace) === activityId) return withWorkspace(state, workspace, (shell) => ({ ...shell, rightOpen: false }));
  return withWorkspace(state, workspace, (shell) => {
    const last = lastTabOf(shell, activityId);
    if (last !== undefined) return focus(shell, last);
    return { ...omit(shell, "active"), rightOpen: true, activity: activityId };
  });
};

export const hideNavigator = (state: ShellState, workspace: string, hidden: boolean): ShellState =>
  withWorkspace(state, workspace, (shell) => ({ ...shell, navigatorHidden: hidden }));

export const hideLeftSidebar = (state: ShellState, hidden: boolean): ShellState => ({ ...state, leftHidden: hidden });

export type RightView =
  | { show: "closed" }
  | { show: "navigator"; activity: string }
  | { show: "tab"; tab: TabEntry }
  | { show: "tab-and-navigator"; tab: TabEntry; activity: string };

/** What the shown workspace's right sidebar shows. */
export const rightView = (state: ShellState, shown: string | undefined): RightView => {
  const shell = shown === undefined ? emptyWorkspace : workspaceShell(state, shown);
  if (!shell.rightOpen) return { show: "closed" };
  const tab = activeTab(shell);
  if (tab === undefined) return shell.activity === undefined ? { show: "closed" } : { show: "navigator", activity: shell.activity };
  const activity = tabActivity(tab.panelId);
  return activity === undefined || shell.navigatorHidden ? { show: "tab", tab } : { show: "tab-and-navigator", tab, activity };
};

export const clampWidth = (width: number, { min, max }: WidthBounds): number => Math.min(max, Math.max(min, width));

/** The right sidebar's width for a kind that wants `wanted`: the dragged width once dragged, else the widest asked for. */
export const rightWidth = (state: ShellState, workspace: string, wanted: number, bounds: WidthBounds): number => {
  const { width, dragged } = workspaceShell(state, workspace).right;
  if (width === undefined) return clampWidth(wanted, bounds);
  return clampWidth(dragged ? width : Math.max(width, wanted), bounds);
};

/** Holds `rightWidth`'s answer as the width, so a kind wanting less later keeps it. */
export const fitRight = (state: ShellState, workspace: string, wanted: number, bounds: WidthBounds): ShellState => {
  const width = rightWidth(state, workspace, wanted, bounds);
  if (width === workspaceShell(state, workspace).right.width) return state;
  return withWorkspace(state, workspace, (shell) => ({ ...shell, right: { ...shell.right, width } }));
};

export const dragRight = (state: ShellState, workspace: string, width: number, bounds: WidthBounds): ShellState =>
  withWorkspace(state, workspace, (shell) => ({ ...shell, right: { width: clampWidth(width, bounds), dragged: true } }));

/** The right sidebar's bounds in a window `available` wide beside the left sidebar: the chat keeps its minimum. */
export const rightBounds = (available: number): WidthBounds => ({
  min: RIGHT_WIDTH.min,
  max: Math.max(RIGHT_WIDTH.min, Math.min(RIGHT_WIDTH.max, available - CHAT_MIN_WIDTH)),
});
