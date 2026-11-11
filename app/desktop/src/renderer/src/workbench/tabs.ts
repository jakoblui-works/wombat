// Tabs in the editor area: one dockview panel per (view, params), its id the tab's key.
import type { DockviewApi, IDockviewPanel } from "dockview-react";

import type { IsKnown } from "./layout.ts";
import { getView, paramsFit, type ResolveContext, type Reveal, viewTitle } from "./registry.ts";
import type { WorkbenchActions } from "./workbench-context.ts";

/** The dockview component every tab renders through; it looks the view up from the panel's params. */
export const TAB_COMPONENT = "view";

/** What a tab's dockview panel holds as its params. */
export type TabParams = { viewId: string; params: unknown };

/** The part of dockview's api the tabs use. */
export type TabHost = Pick<DockviewApi, "getPanel" | "addPanel" | "removePanel" | "panels" | "activeGroup" | "groups">;

/** `value` as JSON with every object's keys sorted, so the same params always give the same text. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  ) ?? "null";

/** A tab's identity: its view and its params. */
export const tabKey = (viewId: string, params: unknown): string => `${viewId}:${stableJson(params)}`;

/** Focuses the tab for (view, params) if it's open; otherwise adds it to the active group (or the first group). */
export const openTab = (host: TabHost, viewId: string, params: unknown, ctx: ResolveContext = { agents: undefined }): void => {
  const id = tabKey(viewId, params);
  const open = host.getPanel(id);
  if (open !== undefined) {
    open.api.setActive();
    return;
  }
  const view = getView(viewId);
  if (view === undefined) throw new Error(`There's no view "${viewId}" to open; register it in workbench/activities.ts.`);
  if (!paramsFit(view, params)) {
    throw new Error(`The params for the view "${viewId}" don't match its paramsSchema; pass what the view registered.`);
  }
  const group = host.activeGroup ?? host.groups[0];
  const tab: TabParams = { viewId, params };
  host.addPanel({
    id,
    component: TAB_COMPONENT,
    title: viewTitle(view, params, ctx),
    params: tab,
    ...(group === undefined ? {} : { position: { referenceGroup: group } }),
  });
};

/** The view and params a panel shows; undefined for a panel that isn't a tab of the workbench's. */
const tabOf = (panel: IDockviewPanel): TabParams | undefined => {
  const params = panel.params as Partial<TabParams> | undefined;
  return typeof params?.viewId === "string" ? { viewId: params.viewId, params: params.params } : undefined;
};

/** Closes every tab that no longer applies (`isKnown`, the same rule as the restore's). */
export const pruneTabs = (host: TabHost, isKnown: IsKnown): void => {
  for (const panel of host.panels) {
    const tab = tabOf(panel);
    if (tab === undefined || !isKnown(tab.viewId, tab.params)) host.removePanel(panel);
  }
};

/** Gives every tab the title its view has for it now. */
export const retitleTabs = (host: TabHost, ctx: ResolveContext): void => {
  for (const panel of host.panels) {
    const tab = tabOf(panel);
    const view = tab && getView(tab.viewId);
    if (tab === undefined || view === undefined) continue;
    const title = viewTitle(view, tab.params, ctx);
    if (panel.title !== title) panel.api.setTitle(title);
  }
};

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

/** The workbench's actions on `host`; `ctx` gives the agents as the page knows them now (for titles). */
export const workbenchActions = (host: TabHost, reveals: ReturnType<typeof revealStore>, ctx: () => ResolveContext): WorkbenchActions => ({
  openTab: (viewId, params, reveal) => {
    const key = tabKey(viewId, params);
    const wasOpen = host.getPanel(key) !== undefined;
    openTab(host, viewId, params, ctx());
    // A new request each time, so the view reveals again; a tab opened anew starts without an old one.
    if (reveal !== undefined) reveals.set(key, { target: reveal });
    else if (!wasOpen) reveals.set(key, undefined);
  },
  closeTab: (viewId, params) => {
    const panel = host.getPanel(tabKey(viewId, params));
    if (panel !== undefined) host.removePanel(panel);
  },
});
