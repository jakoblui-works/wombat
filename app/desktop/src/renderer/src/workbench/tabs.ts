// Tabs in the editor area: one dockview panel per (panel, params), its id the tab's key.
import type { DockviewApi, IDockviewPanel } from "dockview-react";

import type { AgentSummary } from "@wombat/shared/api";
import type { BinderSummary, Item } from "@wombat/shared/items";

import { newCommandId } from "../data/commands.ts";
import { asError, asSentence } from "../lib/errors.ts";
import { AGENTS_ACTIVITY, DESK_ACTIVITY, DESK_PANEL } from "./activity-ids.ts";
import type { IsKnown } from "./layout.ts";
import { getPanel, paramsFit, type ResolveContext, type Reveal, panelTitle } from "./registry.ts";
import { CHAT_PANEL } from "./panels/Chat/chat-params.ts";
import { binderPlace, followPlace } from "./panels/Desk/desk-place.ts";
import { ITEM_PANEL, type ItemParams, NEW_ITEM_TITLE } from "./panels/Item/item-params.ts";
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
 * Which open tabs are temporary, by tab key: the page's memory only, never the tab's params or the saved layout, so a
 * restored tab is kept. Read by the tabs' titles (`useSyncExternalStore`).
 */
const temporaryTabs = new Set<string>();
const temporaryListeners = new Set<() => void>();

const setTemporary = (key: string, temporary: boolean): void => {
  if (temporaryTabs.has(key) === temporary) return;
  if (temporary) temporaryTabs.add(key);
  else temporaryTabs.delete(key);
  for (const listener of temporaryListeners) listener();
};

export const isTemporaryTab = (key: string): boolean => temporaryTabs.has(key);

export const subscribeTemporaryTabs = (listener: () => void): (() => void) => {
  temporaryListeners.add(listener);
  return () => temporaryListeners.delete(listener);
};

/** Makes the tab `key` kept: no temporary tab opened later replaces it. */
export const keepTab = (key: string): void => setTemporary(key, false);

/** Makes every tab kept: a restored layout's tabs are all kept. */
export const keepAllTabs = (): void => {
  for (const key of [...temporaryTabs]) setTemporary(key, false);
};

/** The tab a temporary tab opened in a group replaces: the group's temporary tab, unless it has unsaved edits. */
export const tabToReplace = (tabs: { key: string; temporary: boolean; unsaved: boolean }[]): string | undefined => {
  const temporary = tabs.find((tab) => tab.temporary);
  return temporary === undefined || temporary.unsaved ? undefined : temporary.key;
};

/**
 * The tabs to keep once tab `moved` is in a group with `tabs` (it among them): every other temporary tab, so the group
 * holds one; the moved tab stays as it was.
 */
export const tabsToKeepAfterMove = (tabs: { key: string; temporary: boolean }[], moved: string): string[] =>
  tabs.some((tab) => tab.key === moved && tab.temporary) ? tabs.filter((tab) => tab.temporary && tab.key !== moved).map(({ key }) => key) : [];

/** Keeps what `tabsToKeepAfterMove` says once `panel` was moved into the group it's in now. */
export const settleMovedTab = (panel: IDockviewPanel): void => {
  const tabs = panel.group.panels.map(({ id }) => ({ key: id, temporary: isTemporaryTab(id) }));
  for (const key of tabsToKeepAfterMove(tabs, panel.id)) keepTab(key);
};

/** The questions tabs with unsaved work ask before they close, by tab key: the page's one record (`closeGuards`). */
const closeAsks = new Map<string, () => void>();

type TabPosition = NonNullable<Parameters<TabHost["addPanel"]>[0]["position"]>;

/** Adds the tab for (panel, params) at `position` (dockview's default place without one), temporary or kept. */
const addTab = (host: TabHost, panelId: string, params: unknown, ctx: ResolveContext, position: TabPosition | undefined, temporary = false): void => {
  const panel = getPanel(panelId);
  if (panel === undefined) throw new Error(`There's no panel "${panelId}" to open; register it in workbench/activities.ts.`);
  if (!paramsFit(panel, params)) {
    throw new Error(`The params for the panel "${panelId}" don't match its paramsSchema; pass what the panel registered.`);
  }
  const tab: TabParams = { panelId, params };
  const key = tabKey(panelId, params);
  setTemporary(key, temporary);
  host.addPanel({
    id: key,
    component: TAB_COMPONENT,
    title: panelTitle(panel, params, ctx),
    params: tab,
    ...(position === undefined ? {} : { position }),
  });
};

/** Adds the tab `to` where the open tab `old` is (same group, same position) and closes `old`. */
const addInPlaceOf = (host: TabHost, old: IDockviewPanel, to: TabRef, ctx: ResolveContext, temporary: boolean): void => {
  addTab(host, to.panelId, to.params, ctx, { referenceGroup: old.group, index: old.group.panels.indexOf(old) }, temporary);
  host.removePanel(old);
};

/** How a tab opens: `beside` another tab (its key, while that tab is open), and as a temporary tab. */
export type OpenTabOptions = { beside?: string | undefined; temporary?: boolean | undefined };

/**
 * Focuses the tab for (panel, params) if it's open (kept from now on unless opened as temporary); otherwise adds it to
 * the active group (or the first group). With `beside` it goes beside that tab instead: into the group to the right of
 * that tab's group, or a new group there. A temporary tab takes the place of the group's temporary tab (`tabToReplace`).
 */
export const openTab = (host: TabHost, panelId: string, params: unknown, ctx: ResolveContext = { agents: undefined }, { beside, temporary = false }: OpenTabOptions = {}): void => {
  const key = tabKey(panelId, params);
  const open = host.getPanel(key);
  if (open !== undefined) {
    if (!temporary) keepTab(key);
    open.api.setActive();
    return;
  }
  const besideGroup = beside === undefined ? undefined : host.getPanel(beside)?.group;
  const right = besideGroup === undefined ? undefined : host.adjacentGroupInDirection(besideGroup, "right");
  const group = besideGroup === undefined ? (host.activeGroup ?? host.groups[0]) : right;
  const replaced = !temporary || group === undefined ? undefined : tabToReplace(group.panels.map(({ id }) => ({ key: id, temporary: isTemporaryTab(id), unsaved: closeAsks.has(id) })));
  const old = replaced === undefined ? undefined : host.getPanel(replaced);
  if (old !== undefined) {
    addInPlaceOf(host, old, { panelId, params }, ctx, true);
    return;
  }
  const position =
    besideGroup !== undefined && right === undefined ? { referenceGroup: besideGroup, direction: "right" as const } : group === undefined ? undefined : { referenceGroup: group.id };
  addTab(host, panelId, params, ctx, position, temporary);
};

/** Puts the tab `to` where the open tab `from` is (same group, same position) and closes `from`. */
export const replaceTab = (host: TabHost, from: string, to: TabRef, ctx: ResolveContext = { agents: undefined }): void => {
  const old = host.getPanel(from);
  if (old === undefined) {
    openTab(host, to.panelId, to.params, ctx);
    return;
  }
  const open = host.getPanel(tabKey(to.panelId, to.params));
  if (open === undefined) addInPlaceOf(host, old, to, ctx, false);
  else {
    open.api.setActive();
    host.removePanel(old);
  }
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

/**
 * How tabs with unsaved work ask before they close: a panel registers its question by tab key while it holds such
 * work, and a close the user asks for runs the question instead of closing. One for the page, over `closeAsks`.
 */
const pageCloseGuards = {
  /** Registers `ask` for the tab `key`, which keeps the tab (an edit keeps a temporary tab); returns its unregistration. */
  guard: (key: string, ask: () => void): (() => void) => {
    closeAsks.set(key, ask);
    keepTab(key);
    return () => {
      if (closeAsks.get(key) === ask) closeAsks.delete(key);
    };
  },
  /** A close the user asked for: the tab's question when it has one, else the close. */
  close: (host: Pick<TabHost, "removePanel">, panel: IDockviewPanel): void => {
    const ask = closeAsks.get(panel.id);
    if (ask === undefined) host.removePanel(panel);
    else ask();
  },
};

/** The page's close guards: every call gives the same one. */
export const closeGuards = (): typeof pageCloseGuards => pageCloseGuards;

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

/** The key a sidebar panel's reveal requests are kept under, apart from every tab's. */
export const sidebarRevealKey = (panelId: string): string => `sidebar:${panelId}`;

/** What each tab and sidebar panel was last asked to reveal; tab contents read it by their tab's key. */
export type Reveals = {
  get: (key: string) => Reveal | undefined;
  forget: (key: string) => void;
  subscribe: (listener: () => void) => () => void;
};

/** The reveal requests, and the setter only the workbench's actions use. */
export const revealStore = (): Reveals & { set: (key: string, reveal: Reveal | undefined) => void } => {
  const reveals = new Map<string, Reveal>();
  const listeners = new Set<() => void>();
  const set = (key: string, reveal: Reveal | undefined): void => {
    if (reveal === undefined) reveals.delete(key);
    else reveals.set(key, reveal);
    for (const listener of listeners) listener();
  };
  return {
    get: (key) => reveals.get(key),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    forget: (key) => set(key, undefined),
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

/**
 * What openBinder and followItem need of the page: the binders (read when the page has none yet; undefined when they
 * can't be), an item read afresh by id or handle (undefined when the service finds none; rejects on any other failure),
 * the Desk's sidebar showing a binder, and a message for the user.
 */
export type DeskHost = {
  binders: () => Promise<readonly BinderSummary[] | undefined>;
  item: (ref: string) => Promise<Item | undefined>;
  showBinder: (binderId: string, view: string | undefined) => void;
  tell: (message: string) => void;
};

export const ITEM_NOT_FOUND = "This item can't be found; it may have been deleted. Check the link or reference that named it.";

const itemUnread = (error: unknown): string => `The item couldn't be read: ${asSentence(asError(error).message)} Try again once the service answers.`;

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
  const show = (panelId: string, params: unknown, reveal: string | undefined, temporary: boolean): void => {
    const key = tabKey(panelId, params);
    const wasOpen = host.getPanel(key) !== undefined;
    openTab(host, panelId, params, ctx(), { temporary });
    // A new request each time, so the panel reveals again; a tab opened anew starts without an old one.
    if (reveal !== undefined) reveals.set(key, { target: reveal });
    else if (!wasOpen) reveals.set(key, undefined);
  };
  // Only the latest follow lands: one whose read comes back after a later follow's does nothing.
  let follows = 0;
  const actions: WorkbenchActions = {
    openTab: (panelId, params, reveal) => show(panelId, params, reveal, false),
    openBeside: (panelId, params, beside) => {
      openTab(host, panelId, params, ctx(), { beside: tabKey(beside.panelId, beside.params) });
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
      void desk.binders().then((binders) => {
        const place = binderPlace(binders?.find(({ id }) => id === binderId), view);
        reveals.set(sidebarRevealKey(DESK_PANEL), reveal === undefined ? undefined : { target: reveal });
        desk.showBinder(binderId, place.sidebarView);
        showActivity(DESK_ACTIVITY);
      });
    },
    followItem: (ref) => {
      follows += 1;
      const follow = follows;
      void desk.item(ref).then(
        (item) => {
          if (follow !== follows) return;
          const place = followPlace(item);
          if (place === undefined) {
            desk.tell(ITEM_NOT_FOUND);
            return;
          }
          actions.openBinder(place.binderId, place.itemId);
          actions.openItem(place.binderId, place.itemId, { temporary: true });
        },
        (error: unknown) => {
          if (follow === follows) desk.tell(itemUnread(error));
        },
      );
    },
    openItem: (binderId, itemId, options) => {
      show(ITEM_PANEL, { binderId, itemId } satisfies ItemParams, undefined, options?.temporary === true);
    },
    openNewItem: (binderId, context) => {
      const params = { binderId, draft: newCommandId(), context } satisfies ItemParams;
      actions.openTab(ITEM_PANEL, params);
      host.getPanel(tabKey(ITEM_PANEL, params))?.api.setTitle(NEW_ITEM_TITLE);
    },
    replaceTab: (from, to) => {
      replaceTab(host, tabKey(from.panelId, from.params), to, ctx());
    },
  };
  return actions;
};
