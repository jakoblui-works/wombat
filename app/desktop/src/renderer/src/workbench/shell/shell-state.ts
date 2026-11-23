// The shell's state: which agent is open, which workspace is shown, and each workspace's right sidebar.
import type { AgentSummary, Workspace } from "@wombat/shared/api";
import { z } from "zod";

import { AGENTS_PANEL, DESK_ACTIVITY } from "../activity-ids.ts";
import { DEFAULT_DESK, DeskLayout } from "../items/navigation/desk-layout.ts";
import { getActivity, getPanel, type TabTest } from "../registry.ts";
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
/** What a panel registered without `wants` wants. */
export const RIGHT_DEFAULT_WANTS = 480;
export const CHAT_MIN_WIDTH = 360;
/** The navigator's width beside a tab. */
export const NAVIGATOR_WIDTH = 240;

export const emptyShell: ShellState = { leftHidden: false, barCollapsed: false, workspaces: {} };

const NO_RIGHT_WIDTH: RightWidthEvidence = { dragged: false };

const emptyWorkspace: WorkspaceShell = { tabs: [], navigatorHidden: false, rightOpen: false, activityStates: {}, right: NO_RIGHT_WIDTH };

const keyOf = (tab: TabRef): string => tabKey(tab.panelId, tab.params);

const omit = <T extends object, K extends keyof T>(value: T, ...fields: K[]): Omit<T, K> =>
  Object.fromEntries(Object.entries(value).filter(([field]) => !fields.includes(field as K))) as Omit<T, K>;

/** The toolbar activity a tab belongs to, from its panel's registration. */
export const tabActivity = (panelId: string): string | undefined => getPanel(panelId)?.activity;

const activeTab = (shell: WorkspaceShell): TabEntry | undefined => shell.tabs.find((tab) => keyOf(tab) === shell.active);

const workspaceShell = (state: ShellState, workspace: string): WorkspaceShell => state.workspaces[workspace] ?? emptyWorkspace;

const withWorkspace = (state: ShellState, workspace: string, change: (shell: WorkspaceShell) => WorkspaceShell): ShellState => {
  const before = workspaceShell(state, workspace);
  const changed = change(before);
  const shell = before.rightOpen && !changed.rightOpen ? { ...changed, right: NO_RIGHT_WIDTH } : changed;
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

/** Shows `workspace` unless it is shown: its last started agent's chat, else the empty chat on it. */
export const showWorkspace = (
  state: ShellState,
  workspace: string,
  agents: readonly Pick<AgentSummary, "id" | "workspace" | "startedAt">[] | undefined,
  workspaces?: readonly Pick<Workspace, "id">[],
): ShellState => {
  if (shownWorkspace(state, agents, workspaces) === workspace) return state;
  const newest = agents
    ?.filter((agent) => agent.workspace === workspace)
    .reduce<(typeof agents)[number] | undefined>((top, agent) => (top === undefined || agent.startedAt > top.startedAt ? agent : top), undefined);
  return newest === undefined ? newChat(state, workspace) : openAgent(state, newest.id);
};

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
  workspaceShell(state, workspace).tabs.some((tab) => keyOf(tab) === key && !tab.kept)
    ? withWorkspace(state, workspace, (shell) => ({ ...shell, tabs: shell.tabs.map((tab) => (keyOf(tab) === key ? { ...tab, kept: true } : tab)) }))
    : state;

export const activateTab = (state: ShellState, workspace: string, key: string): ShellState => withWorkspace(state, workspace, (shell) => focus(shell, key));

const forgetTab = (lastActive: WorkspaceShell["lastActive"], key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(lastActive ?? {}).filter(([, last]) => last !== key));

/**
 * Closes the tab; an active one hands over to its neighbour. With no tab left the sidebar stays open on the closed
 * tab's activity's navigator, or closes for a tab without one.
 */
export const closeTab = (state: ShellState, workspace: string, key: string): ShellState =>
  withWorkspace(state, workspace, (shell) => closedTab(shell, key));

const closedTab = (shell: WorkspaceShell, key: string): WorkspaceShell => {
  const index = shell.tabs.findIndex((tab) => keyOf(tab) === key);
  const closed = shell.tabs[index];
  if (closed === undefined) return shell;
  const tabs = shell.tabs.filter((_, at) => at !== index);
  const lastActive = forgetTab(shell.lastActive, key);
  if (shell.active !== key) return { ...shell, tabs, lastActive };
  const rest = omit({ ...shell, tabs, lastActive }, "active");
  const neighbour = tabs[index] ?? tabs[index - 1];
  if (neighbour !== undefined) return focus(rest, keyOf(neighbour));
  const activity = tabActivity(closed.panelId);
  return activity === undefined ? { ...rest, rightOpen: false } : { ...rest, activity };
};

/** The tab gone without the user closing it: as a close, but a closed sidebar stays closed on its activity. */
const droppedTab = (shell: WorkspaceShell, key: string): WorkspaceShell => {
  const closed = closedTab(shell, key);
  if (shell.rightOpen) return closed;
  const kept = { ...omit(closed, "activity"), rightOpen: false };
  return shell.activity === undefined ? kept : { ...kept, activity: shell.activity };
};

/** Puts `to` where tab `from` is, kept and active, and closes `from`; with `from` not open, opens `to` kept. */
export const replaceTab = (state: ShellState, workspace: string, from: string, to: TabRef): ShellState => {
  const toKey = keyOf(to);
  const { tabs } = workspaceShell(state, workspace);
  const at = tabs.findIndex((tab) => keyOf(tab) === from);
  if (at === -1) return openTab(state, workspace, to, { temporary: false });
  if (tabs.some((tab) => keyOf(tab) === toKey)) return closeTab(activateTab(state, workspace, toKey), workspace, from);
  const entry: TabEntry = { panelId: to.panelId, params: to.params, kept: true };
  return withWorkspace(state, workspace, (shell) =>
    focus({ ...shell, tabs: shell.tabs.map((tab, index) => (index === at ? entry : tab)), lastActive: forgetTab(shell.lastActive, from) }, toKey),
  );
};

/** Closes every tab of the strip but `key` that `isDirty` doesn't hold back, and activates `key`. */
export const closeOtherTabs = (state: ShellState, workspace: string, key: string, isDirty: (key: string) => boolean): ShellState =>
  workspaceShell(state, workspace)
    .tabs.map(keyOf)
    .filter((other) => other !== key && !isDirty(other))
    .reduce((current, other) => closeTab(current, workspace, other), activateTab(state, workspace, key));

/** The workspace whose strip holds tab `key`: `preferred` if its strip does, else the first that does. */
export const tabWorkspace = (state: ShellState, key: string, preferred?: string): string | undefined => {
  const holds = (workspace: string) => workspaceShell(state, workspace).tabs.some((tab) => keyOf(tab) === key);
  if (preferred !== undefined && holds(preferred)) return preferred;
  return Object.keys(state.workspaces).find(holds);
};

export const allTabs = (state: ShellState): TabEntry[] => Object.values(state.workspaces).flatMap(({ tabs }) => tabs);

const dropTabsWhere = (state: ShellState, drop: (tab: TabEntry) => boolean): ShellState =>
  Object.entries(state.workspaces).reduce(
    (current, [workspace, { tabs }]) =>
      tabs.filter(drop).reduce((pruned, tab) => withWorkspace(pruned, workspace, (shell) => droppedTab(shell, keyOf(tab))), current),
    state,
  );

/** Drops the tabs that no longer `apply`, in every workspace, leaving a closed sidebar closed; the same state when all do. */
export const pruneTabs = (state: ShellState, apply: TabTest): ShellState => dropTabsWhere(state, (tab) => !apply(tab.panelId, tab.params));

// The state never saved: the right sidebar's width evidence, and the composer bar's pick and collapse.
const UNSAVED_WORKSPACE_FIELDS = ["right"] as const;
const UNSAVED_SHELL_FIELDS = ["newChatWorkspace", "barCollapsed"] as const;

type SavedWorkspace = Flat<Omit<WorkspaceShell, (typeof UNSAVED_WORKSPACE_FIELDS)[number] | "tabs"> & { tabs: TabRef[] }>;
/** What settings.json holds of the shell. */
export type SavedShell = Omit<ShellState, (typeof UNSAVED_SHELL_FIELDS)[number] | "workspaces"> & { workspaces: Record<string, SavedWorkspace> };

type Flat<T> = { [K in keyof T]: T[K] };
type Same<A, B> = (<T>() => T extends Flat<A> ? 1 : 2) extends <T>() => T extends Flat<B> ? 1 : 2 ? true : false;

/** `schema`, which only compiles when it parses exactly `T`: no field more or less, none with another type or optionality. */
const parsing =
  <T>() =>
  <S extends z.ZodType>(schema: S & (Same<z.infer<S>, T> extends true ? unknown : never)): S =>
    schema;

const SavedWorkspace = parsing<SavedWorkspace>()(
  z.object({
    tabs: z.array(z.object({ panelId: z.string(), params: z.unknown() })),
    active: z.string().exactOptional(),
    activity: z.string().exactOptional(),
    navigatorHidden: z.boolean(),
    rightOpen: z.boolean(),
    activityStates: z.record(z.string(), z.unknown()),
    lastActive: z.record(z.string(), z.string()).exactOptional(),
  }),
);

const SavedShell = parsing<SavedShell>()(
  z.object({ openAgent: z.string().exactOptional(), leftHidden: z.boolean(), workspaces: z.record(z.string(), SavedWorkspace) }),
);

const savedWorkspace = (shell: WorkspaceShell): SavedWorkspace => ({
  ...omit(shell, ...UNSAVED_WORKSPACE_FIELDS),
  tabs: shell.tabs.map(({ panelId, params }) => ({ panelId, params })),
  activityStates: registeredStates(shell.activityStates),
});

const registeredStates = (states: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(states).filter(([id]) => id === AGENTS_PANEL || getActivity(id) !== undefined));

/** The saved states of the activities and the overview (its collapsed groups); a Desk state that doesn't parse is `DEFAULT_DESK`. */
const restoredStates = (states: Record<string, unknown>): Record<string, unknown> => {
  const registered = registeredStates(states);
  if (!(DESK_ACTIVITY in registered)) return registered;
  const desk = DeskLayout.safeParse(registered[DESK_ACTIVITY]);
  return { ...registered, [DESK_ACTIVITY]: desk.success ? desk.data : DEFAULT_DESK };
};

/** The shell as saved: kept tabs that `isSaved` takes, the activities' and the overview's states, no widths, nor the composer bar's picks. */
export const savedShell = (state: ShellState, isSaved: TabTest): SavedShell => {
  const kept = dropTabsWhere(state, (tab) => !tab.kept || !isSaved(tab.panelId, tab.params));
  return {
    ...omit(kept, ...UNSAVED_SHELL_FIELDS),
    workspaces: Object.fromEntries(Object.entries(kept.workspaces).map(([id, shell]) => [id, savedWorkspace(shell)])),
  };
};

const restoredWorkspace = ({ tabs, active, activityStates, ...rest }: SavedWorkspace): WorkspaceShell => {
  const restored = tabs.map(({ panelId, params }) => ({ panelId, params, kept: true }));
  const shown = active !== undefined && restored.some((tab) => keyOf(tab) === active);
  return { ...emptyWorkspace, ...rest, tabs: restored, ...(shown ? { active } : {}), activityStates: restoredStates(activityStates) };
};

/** The shell `raw` (savedShell's value, read back) describes, without the tabs `isRestorable` refuses; `emptyShell` when it doesn't parse. */
export const restoredShell = (raw: unknown, isRestorable: TabTest): ShellState => {
  const parsed = SavedShell.safeParse(raw);
  if (!parsed.success) return emptyShell;
  const { workspaces, ...rest } = parsed.data;
  const state: ShellState = {
    ...emptyShell,
    ...rest,
    workspaces: Object.fromEntries(Object.entries(workspaces).map(([id, saved]) => [id, restoredWorkspace(saved)])),
  };
  return pruneTabs(state, isRestorable);
};

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

/** Opens the sidebar on the activity as its button would, unless that button is the active one already. */
export const showActivity = (state: ShellState, workspace: string, activityId: string): ShellState =>
  activeToolbarButton(state, workspace) === activityId ? state : pressToolbarButton(state, workspace, activityId);

export const activityStatesOf = (state: ShellState, workspace: string | undefined): Record<string, unknown> =>
  workspace === undefined ? emptyWorkspace.activityStates : workspaceShell(state, workspace).activityStates;

export const changeActivityState = (state: ShellState, workspace: string, activityId: string, change: (activityState: unknown) => unknown): ShellState =>
  withWorkspace(state, workspace, (shell) => ({ ...shell, activityStates: { ...shell.activityStates, [activityId]: change(shell.activityStates[activityId]) } }));

export const hideNavigator = (state: ShellState, workspace: string, hidden: boolean): ShellState =>
  withWorkspace(state, workspace, (shell) => ({ ...shell, navigatorHidden: hidden }));

export const hideLeftSidebar = (state: ShellState, hidden: boolean): ShellState => ({ ...state, leftHidden: hidden });

export const collapseBar = (state: ShellState, collapsed: boolean): ShellState => ({ ...state, barCollapsed: collapsed });

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

export const shownTab = (state: ShellState, workspace: string | undefined): TabEntry | undefined => {
  const view = rightView(state, workspace);
  return view.show === "tab" || view.show === "tab-and-navigator" ? view.tab : undefined;
};

export const shownNavigator = (state: ShellState, workspace: string | undefined): string | undefined => {
  const view = rightView(state, workspace);
  return view.show === "navigator" || view.show === "tab-and-navigator" ? view.activity : undefined;
};

/** What the user sees of the shell, without the parts the page changes on its own (collapsed groups, widths). */
export type ShownView = {
  openAgent: string | undefined;
  newChatWorkspace: string | undefined;
  workspace: string | undefined;
  tab: string | undefined;
  rightOpen: boolean;
  activity: string | undefined;
  navigator: string | undefined;
};

export const shownView = (
  state: ShellState,
  agents: readonly Pick<AgentSummary, "id" | "workspace">[] | undefined,
  workspaces?: readonly Pick<Workspace, "id">[],
): ShownView => {
  const workspace = shownWorkspace(state, agents, workspaces);
  const shell = workspace === undefined ? emptyWorkspace : workspaceShell(state, workspace);
  return {
    openAgent: state.openAgent,
    newChatWorkspace: state.newChatWorkspace,
    workspace,
    tab: shell.active,
    rightOpen: shell.rightOpen,
    activity: shell.activity,
    navigator: shownNavigator(state, workspace),
  };
};

export const sameView = (a: ShownView, b: ShownView): boolean => (Object.keys(a) as (keyof ShownView)[]).every((field) => a[field] === b[field]);

export const navigatorToggle = (state: ShellState, workspace: string): "hide" | "show" | undefined => {
  const view = rightView(state, workspace);
  if (view.show === "tab-and-navigator") return "hide";
  if (view.show === "tab" && tabActivity(view.tab.panelId) !== undefined) return "show";
  return undefined;
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

/**
 * The right sidebar's bounds in a window `available` wide beside the left sidebar: the chat keeps its minimum, the
 * sidebar giving way below its own when the room is short.
 */
export const rightBounds = (available: number): WidthBounds => {
  const min = Math.min(RIGHT_WIDTH.min, Math.max(0, available - CHAT_MIN_WIDTH));
  return { min, max: Math.max(min, Math.min(RIGHT_WIDTH.max, available - CHAT_MIN_WIDTH)) };
};

/**
 * The left sidebar's bounds for a drag, in a row `room` wide not counting its resize handles: the chat keeps its minimum, and the
 * right sidebar, while open, its own.
 */
export const leftBounds = (room: number, rightOpen: boolean): WidthBounds => ({
  min: LEFT_WIDTH.min,
  max: Math.max(LEFT_WIDTH.min, Math.min(LEFT_WIDTH.max, room - CHAT_MIN_WIDTH - (rightOpen ? RIGHT_WIDTH.min : 0))),
});

/** The width the shown kind wants: the active tab's panel, else the navigator alone; undefined while closed. */
export const rightWanted = (view: RightView): number | undefined => {
  if (view.show === "closed") return undefined;
  const panelId = view.show === "navigator" ? getActivity(view.activity)?.navigator : view.tab.panelId;
  return (panelId === undefined ? undefined : getPanel(panelId)?.wants) ?? RIGHT_DEFAULT_WANTS;
};

/** `rightWidth` for what `workspace`'s right sidebar shows; undefined while it's closed. */
export const shownRightWidth = (state: ShellState, workspace: string, bounds: WidthBounds): number | undefined => {
  const wanted = rightWanted(rightView(state, workspace));
  return wanted === undefined ? undefined : rightWidth(state, workspace, wanted, bounds);
};

/**
 * `fitRight` for what `workspace`'s right sidebar shows, within `RIGHT_WIDTH` only: the window's bounds clamp the drawn
 * width, never the evidence, so a window shrunk and regrown gets its width back. The same state while it's closed, so
 * its evidence stays reset.
 */
export const fitShownRight = (state: ShellState, workspace: string): ShellState => {
  const wanted = rightWanted(rightView(state, workspace));
  return wanted === undefined ? state : fitRight(state, workspace, wanted, RIGHT_WIDTH);
};

/**
 * Moves the open right sidebar's left edge `dx` pixels to the right, as a drag, from its drawn width; stores the width
 * drawn after it (within `bounds`). The same state while it's closed.
 */
export const dragShownRight = (state: ShellState, workspace: string, dx: number, bounds: WidthBounds): ShellState => {
  const width = shownRightWidth(state, workspace, bounds);
  return width === undefined ? state : dragRight(state, workspace, width - dx, bounds);
};
