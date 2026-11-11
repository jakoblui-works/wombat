// Tabs in the editor area: one dockview panel per (view, params), its id the tab's key.
import type { DockviewApi } from "dockview-react";

import { getView, viewTitle } from "./registry.ts";

/** The dockview component every tab renders through; it looks the view up from the panel's params. */
export const TAB_COMPONENT = "view";

/** What a tab's dockview panel holds as its params. */
export type TabParams = { viewId: string; params: unknown };

/** The part of dockview's api that opening a tab uses. */
export type TabHost = Pick<DockviewApi, "getPanel" | "addPanel" | "activeGroup" | "groups">;

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
export const openTab = (host: TabHost, viewId: string, params: unknown): void => {
  const id = tabKey(viewId, params);
  const open = host.getPanel(id);
  if (open !== undefined) {
    open.api.setActive();
    return;
  }
  const view = getView(viewId);
  if (view === undefined) throw new Error(`There's no view "${viewId}" to open; register it in workbench/activities.ts.`);
  if (view.paramsSchema !== undefined && !view.paramsSchema.safeParse(params).success) {
    throw new Error(`The params for the view "${viewId}" don't match its paramsSchema; pass what the view registered.`);
  }
  const group = host.activeGroup ?? host.groups[0];
  const tab: TabParams = { viewId, params };
  host.addPanel({
    id,
    component: TAB_COMPONENT,
    title: viewTitle(view, params),
    params: tab,
    ...(group === undefined ? {} : { position: { referenceGroup: group } }),
  });
};
