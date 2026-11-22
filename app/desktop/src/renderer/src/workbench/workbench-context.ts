// What panels may ask of the workbench they're shown in.
import { createContext, useContext, useEffect } from "react";

import type { DeskLayout } from "./layout.ts";
import type { ResolveContext } from "./registry.ts";
import { closeGuards, type OpenTabOptions, type revealStore, tabKey, type TabHost } from "./tabs.ts";

/** A tab: the panel it shows and its params (its identity, with `tabKey`). */
export type TabRef = { panelId: string; params: unknown };

/** How a tab opens: as a temporary tab (a row's click), or kept. */
export type OpenOptions = Pick<OpenTabOptions, "temporary">;

export type WorkbenchActions = {
  /**
   * Opens (or focuses) the tab for this panel and params in the editor area. `reveal` (a permission request's id)
   * reaches the tab's panel as its `reveal` prop; it isn't part of the tab's identity.
   */
  openTab: (panelId: string, params: unknown, reveal?: string) => void;
  /**
   * Opens (or focuses) the tab for this panel and params beside the tab `beside`: in the group to the right of that
   * tab's group, or a new group there (the diff tab beside its chat).
   */
  openBeside: (panelId: string, params: unknown, beside: TabRef) => void;
  /** Closes the tab for this panel and params, if it's open. */
  closeTab: (panelId: string, params: unknown) => void;
  /**
   * Opens tab `to` where tab `from` is (same group, same position) and closes `from` without asking its close guard;
   * with `from` not open, opens `to` as openTab does.
   */
  replaceTab: (from: TabRef, to: TabRef) => void;
};

/** What a topic's navigation builds on, beside the actions. */
export type WorkbenchContextValue = WorkbenchActions & {
  /** Undefined until dockview is ready; a navigation does nothing until then. */
  host: TabHost | undefined;
  reveals: ReturnType<typeof revealStore>;
  showActivity: (activityId: string) => void;
  /** The tabs' titles' context as the page knows it now. */
  titleContext: () => ResolveContext;
};

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export const useWorkbench = (): WorkbenchContextValue => {
  const workbench = useContext(WorkbenchContext);
  if (workbench === undefined) throw new Error("useWorkbench is used outside the Workbench; render the panel inside it.");
  return workbench;
};

/** The tab that's active in the editor area; undefined while no tab is open. */
export type ActiveTab = TabRef;

export const ActiveTabContext = createContext<ActiveTab | undefined>(undefined);

/** The active tab, for a panel that marks what's open (the agent list marks the active chat). */
export const useActiveTab = (): ActiveTab | undefined => useContext(ActiveTabContext);

/** The Desk as the user left it, and the one way to change it (saved with the layout). */
export type DeskState = { desk: DeskLayout; changeDesk: (change: (desk: DeskLayout) => DeskLayout) => void };

export const DeskContext = createContext<DeskState | undefined>(undefined);

export const useDesk = (): DeskState => {
  const state = useContext(DeskContext);
  if (state === undefined) throw new Error("useDesk is used outside the Workbench; render the panel inside it.");
  return state;
};

/** The Desk's change function alone: its identity outlives every Desk change, so a reader doesn't re-render on one. */
export const ChangeDeskContext = createContext<DeskState["changeDesk"] | undefined>(undefined);

export const useChangeDesk = (): DeskState["changeDesk"] => {
  const changeDesk = useContext(ChangeDeskContext);
  if (changeDesk === undefined) throw new Error("useChangeDesk is used outside the Workbench; render the panel inside it.");
  return changeDesk;
};

/** While `ask` is given, a close of the tab (its X, Close, Ctrl+W) runs `ask` instead; the panel closes it itself. */
export const useCloseGuard = (tab: TabRef, ask: (() => void) | undefined): void => {
  const key = tabKey(tab.panelId, tab.params);
  useEffect(() => (ask === undefined ? undefined : closeGuards().guard(key, ask)), [key, ask]);
};
