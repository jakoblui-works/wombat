// Tabs in the editor area: one dockview panel per (panel, params), its id the tab's key.
import type { DockviewApi, IDockviewPanel } from "dockview-react";

import type { AgentSummary } from "@wombat/shared/api";
import type { BinderSummary } from "@wombat/shared/items";

import { AGENTS_ACTIVITY, DESK_ACTIVITY } from "./activity-ids.ts";
import type { IsKnown } from "./layout.ts";
import { getPanel, paramsFit, type ResolveContext, type Reveal, panelTitle } from "./registry.ts";
import { CHAT_PANEL } from "./panels/Chat/chat-params.ts";
import { BOARD_PANEL, type BoardParams } from "./panels/Desk/board-params.ts";
import { binderPlace } from "./panels/Desk/desk-view.ts";
import { PROPOSAL_PANEL, type ProposalParams } from "./panels/Proposal/proposal-params.ts";
import type { TabRef, WorkbenchActions } from "./workbench-context.ts";

/** The dockview component every tab renders through; it looks the panel up from the panel's params. */
export const TAB_COMPONENT = "panel";

/** What a tab's dockview panel holds as its params. */
export type TabParams = TabRef;

/** The part of dockview's api the tabs use. */
export type TabHost = Pick<DockviewApi, "getPanel" | "addPanel" | "removePanel" | "panels" | "activeGroup" | "groups" | "adjacentGroupInDirection" | "addGroup" | "getGroup" | "removeGroup">;

/** `value` as JSON with every object's keys sorted, so the same params always give the same text. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  ) ?? "null";

/** A tab's identity: its panel and its params. */
export const tabKey = (panelId: string, params: unknown): string => `${panelId}:${stableJson(params)}`;

/**
 * Focuses the tab for (panel, params) if it's open; otherwise adds it to the active group (or the first group). With
 * `beside` (another tab's key, while that tab is open) it goes beside that tab instead: into the group to the right of
 * that tab's group, or a new group there.
 */
export const openTab = (host: TabHost, panelId: string, params: unknown, ctx: ResolveContext = { agents: undefined }, beside?: string): void => {
  const id = tabKey(panelId, params);
  const open = host.getPanel(id);
  if (open !== undefined) {
    open.api.setActive();
    return;
  }
  const panel = getPanel(panelId);
  if (panel === undefined) throw new Error(`There's no panel "${panelId}" to open; register it in workbench/activities.ts.`);
  if (!paramsFit(panel, params)) {
    throw new Error(`The params for the panel "${panelId}" don't match its paramsSchema; pass what the panel registered.`);
  }
  const besideGroup = beside === undefined ? undefined : host.getPanel(beside)?.group;
  const right = besideGroup === undefined ? undefined : host.adjacentGroupInDirection(besideGroup, "right");
  const group = host.activeGroup ?? host.groups[0];
  const position =
    besideGroup === undefined
      ? group === undefined
        ? undefined
        : { referenceGroup: group }
      : right === undefined
        ? { referenceGroup: besideGroup, direction: "right" as const }
        : { referenceGroup: right.id };
  const tab: TabParams = { panelId, params };
  host.addPanel({
    id,
    component: TAB_COMPONENT,
    title: panelTitle(panel, params, ctx),
    params: tab,
    ...(position === undefined ? {} : { position }),
  });
};

/** The sides of a group a split can open on. */
export type SplitDirection = "right" | "down" | "left" | "up";

/** Dockview's name for each side. */
const DOCKVIEW_DIRECTION = { right: "right", down: "below", left: "left", up: "above" } as const;

/**
 * Adds an empty group on the `direction` side of group `referenceGroupId` (default: the active group, else the first)
 * and makes it the active one: it's where the next thing opens.
 */
export const splitEmpty = (host: TabHost, direction: SplitDirection, referenceGroupId?: string): void => {
  const reference = referenceGroupId === undefined ? (host.activeGroup ?? host.groups[0]) : host.groups.find(({ id }) => id === referenceGroupId);
  if (referenceGroupId !== undefined && reference === undefined) throw new Error(`There's no group "${referenceGroupId}" to split; pass the id of a group in the editor.`);
  const group = host.addGroup(reference === undefined ? undefined : { referenceGroup: reference, direction: DOCKVIEW_DIRECTION[direction] });
  group.api.setActive();
};

/** Whether group `groupId` may be closed: it has no tab, and it isn't the only group (the editor always keeps one). */
export const canCloseGroup = (host: Pick<TabHost, "getGroup" | "groups">, groupId: string): boolean => host.getGroup(groupId)?.panels.length === 0 && host.groups.length > 1;

export const closeEmptyGroup = (host: TabHost, groupId: string): void => {
  const group = host.getGroup(groupId);
  if (group !== undefined && canCloseGroup(host, groupId)) host.removeGroup(group);
};

/** The panel and params a dockview panel shows; undefined for a panel that isn't a tab of the workbench's. */
const tabOf = (panel: IDockviewPanel): TabParams | undefined => {
  const params = panel.params as Partial<TabParams> | undefined;
  return typeof params?.panelId === "string" ? { panelId: params.panelId, params: params.params } : undefined;
};

/** Closes every tab that no longer applies (`isKnown`, the same rule as the restore's). */
export const pruneTabs = (host: TabHost, isKnown: IsKnown): void => {
  for (const panel of host.panels) {
    const tab = tabOf(panel);
    if (tab === undefined || !isKnown(tab.panelId, tab.params)) host.removePanel(panel);
  }
};

/**
 * Gives every tab the title its panel has for it now: the one its panel reported for the tab (`reported`, by tab key),
 * else the panel's `title` when that's a function of the agents list. A static `title` was set when the tab opened and
 * isn't set again, so a restored tab keeps its saved title until its panel reports one.
 */
export const retitleTabs = (host: TabHost, ctx: ResolveContext, reported: (key: string) => string | undefined = () => undefined): void => {
  for (const panel of host.panels) {
    const tab = tabOf(panel);
    const registered = tab && getPanel(tab.panelId);
    if (tab === undefined || registered === undefined) continue;
    const title = reported(panel.id) ?? (typeof registered.title === "function" ? registered.title(tab.params, ctx) : undefined);
    if (title !== undefined && panel.title !== title) panel.api.setTitle(title);
  }
};

/** The part of a dockview panel's api a title report touches. */
type TitledPanel = { id: string; title: string | undefined; setTitle: (title: string) => void };

/**
 * The titles panels reported for their tabs (`PanelProps.setTitle`), by tab key: they take the place of the panel's
 * `title` in `retitleTabs`. A tab's report is forgotten when its panel unmounts.
 */
export const tabTitles = () => {
  const titles = new Map<string, string>();
  return {
    report: (panel: TitledPanel, title: string): void => {
      titles.set(panel.id, title);
      if (panel.title !== title) panel.setTitle(title);
    },
    forget: (key: string): void => {
      titles.delete(key);
    },
    get: (key: string): string | undefined => titles.get(key),
  };
};

/**
 * A dockview layout change without its title changes: a tab's title follows the agents list or its panel, never the
 * user, so it must not arm the saver. Reasons it was coalesced with (a tab the user opened) still count.
 */
export const withoutTitleChanges = (reasons: ReadonlySet<string>): ReadonlySet<string> => new Set([...reasons].filter((reason) => reason !== "panelTitle"));

/** What each tab was last asked to reveal; tab contents read it by their tab's key. */
export type Reveals = {
  get: (key: string) => Reveal | undefined;
  subscribe: (listener: () => void) => () => void;
};

/** The reveal requests, and the setter only the workbench's actions use. */
export const revealStore = (): Reveals & { set: (key: string, reveal: Reveal | undefined) => void } => {
  const reveals = new Map<string, Reveal>();
  const listeners = new Set<() => void>();
  return {
    get: (key) => reveals.get(key),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (key, reveal) => {
      if (reveal === undefined) reveals.delete(key);
      else reveals.set(key, reveal);
      for (const listener of listeners) listener();
    },
  };
};

/** The agent's oldest open request: the smallest `at`, the first listed of equals. */
const oldestPending = (agent: AgentSummary | undefined): string | undefined => {
  let oldest: AgentSummary["pendingPermissions"][number] | undefined;
  for (const request of agent?.pendingPermissions ?? []) {
    if (oldest === undefined || Date.parse(request.at) < Date.parse(oldest.at)) oldest = request;
  }
  return oldest?.requestId;
};

/** What openBinder needs of the page: the binders as it knows them now, and the Desk's sidebar showing a binder. */
export type DeskHost = { binders: () => readonly BinderSummary[] | undefined; showBinder: (binderId: string, view: string | undefined) => void };

/**
 * The workbench's actions on `host`; `ctx` gives the agents as the page knows them now (for titles and the oldest
 * request); `showActivity` switches the left sidebar to an activity.
 */
export const workbenchActions = (
  host: TabHost,
  reveals: ReturnType<typeof revealStore>,
  ctx: () => ResolveContext,
  showActivity: (activity: string) => void,
  desk: DeskHost,
): WorkbenchActions => {
  const actions: WorkbenchActions = {
    openTab: (panelId, params, reveal) => {
      const key = tabKey(panelId, params);
      const wasOpen = host.getPanel(key) !== undefined;
      openTab(host, panelId, params, ctx());
      // A new request each time, so the panel reveals again; a tab opened anew starts without an old one.
      if (reveal !== undefined) reveals.set(key, { target: reveal });
      else if (!wasOpen) reveals.set(key, undefined);
    },
    openBeside: (panelId, params, beside) => {
      openTab(host, panelId, params, ctx(), tabKey(beside.panelId, beside.params));
    },
    closeTab: (panelId, params) => {
      const panel = host.getPanel(tabKey(panelId, params));
      if (panel !== undefined) host.removePanel(panel);
    },
    openAgentChat: (agentId, requestId) => {
      showActivity(AGENTS_ACTIVITY);
      const agent = ctx().agents?.find(({ id }) => id === agentId);
      actions.openTab(CHAT_PANEL, { agentId }, requestId ?? oldestPending(agent));
    },
    openProposal: (proposalId) => {
      actions.openTab(PROPOSAL_PANEL, { proposalId } satisfies ProposalParams);
    },
    openBinder: (binderId, reveal, view) => {
      const place = binderPlace(desk.binders()?.find(({ id }) => id === binderId), view);
      if (place.board !== undefined) actions.openTab(BOARD_PANEL, { binderId, view: place.board } satisfies BoardParams, reveal);
      desk.showBinder(binderId, place.sidebarView);
      showActivity(DESK_ACTIVITY);
    },
  };
  return actions;
};
