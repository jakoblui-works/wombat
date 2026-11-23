// What panels may ask of the workbench they're shown in.
import { createContext, useContext, useEffect } from "react";

import { closeGuards, type revealStore, type TabRef, tabKey } from "./tabs.ts";

/** How a tab opens: as a temporary tab (a row's click), or kept. */
export type OpenOptions = { temporary?: boolean | undefined };

/**
 * Where and how a tab opens: in `workspace`'s strip (default: the shown workspace's), temporary or kept (default), and
 * with the start `title` it has until its panel reports one (else its panel's title).
 */
export type TabOpenOptions = OpenOptions & { workspace?: string | undefined; title?: string | undefined };

export type WorkbenchActions = {
  /**
   * Opens (or focuses) the tab for this panel and params in the right sidebar's strip. `reveal` (a permission request's
   * id) reaches the tab's panel as its `reveal` prop; it isn't part of the tab's identity.
   */
  openTab: (panelId: string, params: unknown, reveal?: string, options?: TabOpenOptions) => void;
  /** Closes the tab for this panel and params, if it's open, without asking its close guard. */
  closeTab: (panelId: string, params: unknown) => void;
  /**
   * Opens tab `to` where tab `from` is (same strip, same position) and closes `from` without asking its close guard;
   * with `from` not open, opens `to` as openTab does.
   */
  replaceTab: (from: TabRef, to: TabRef) => void;
};

export type WorkbenchContextValue = WorkbenchActions & {
  /** Every workspace's open tabs on panel `panelId`. */
  openTabs: (panelId: string) => TabRef[];
  reveals: Pick<ReturnType<typeof revealStore>, "set">;
  /** Opens `workspace`'s right sidebar (default: the shown workspace's) on the activity, unless it shows it already. */
  showActivity: (activityId: string, workspace?: string) => void;
};

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export const useWorkbench = (): WorkbenchContextValue => {
  const workbench = useContext(WorkbenchContext);
  if (workbench === undefined) throw new Error("useWorkbench is used outside the Workbench; render the panel inside it.");
  return workbench;
};

/** The tab the right sidebar shows; undefined while it shows none. */
export type ActiveTab = TabRef;

export const ActiveTabContext = createContext<ActiveTab | undefined>(undefined);

/** The active tab, for a panel that marks what's open (the agent list marks the active chat). */
export const useActiveTab = (): ActiveTab | undefined => useContext(ActiveTabContext);

/** While `ask` is given, a close of the tab (its X, Close, Ctrl+W) runs `ask` instead; the panel closes it itself. */
export const useCloseGuard = (tab: TabRef, ask: (() => void) | undefined): void => {
  const key = tabKey(tab.panelId, tab.params);
  useEffect(() => (ask === undefined ? undefined : closeGuards().guard(key, ask)), [key, ask]);
};
