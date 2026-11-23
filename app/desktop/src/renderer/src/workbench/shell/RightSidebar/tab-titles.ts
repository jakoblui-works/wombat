import { getPanel, panelTitle, type ResolveContext } from "../../registry.ts";
import type { TabRef } from "../../workbench-context.ts";

/**
 * The titles tabs hold beside their panel's, by tab key: the start title a tab opened with, then the one its panel
 * reported (`PanelProps.setTitle`). Read by the strip (`useSyncExternalStore`).
 */
export const tabTitleStore = () => {
  const titles = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    set: (key: string, title: string): void => {
      if (titles.get(key) === title) return;
      titles.set(key, title);
      changed();
    },
    /** Forgets the titles of every tab but `open`'s. */
    keepOnly: (open: ReadonlySet<string>): void => {
      const closed = [...titles.keys()].filter((key) => !open.has(key));
      for (const key of closed) titles.delete(key);
      if (closed.length > 0) changed();
    },
    get: (key: string): string | undefined => titles.get(key),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export type TabTitles = ReturnType<typeof tabTitleStore>;

/** A tab's title: the one it holds, else its panel's for its params. */
export const tabTitle = (tab: TabRef, held: string | undefined, ctx: ResolveContext): string => {
  if (held !== undefined) return held;
  const panel = getPanel(tab.panelId);
  return panel === undefined ? tab.panelId : panelTitle(panel, tab.params, ctx);
};
