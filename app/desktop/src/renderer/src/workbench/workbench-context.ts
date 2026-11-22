// What panels may ask of the workbench they're shown in.
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";

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

/** Each activity's state as the user left it, by activity id; an activity's own wrapper gives it a type. */
export type ActivityStates = Record<string, unknown>;

/** Changes one activity's state; the layout is saved after it, as after any change the user makes. */
export type ChangeActivityStates = (activityId: string, change: (state: unknown) => unknown) => void;

export type ActivityState = { state: unknown; change: (change: (state: unknown) => unknown) => void };

export const ActivityStateContext = createContext<ActivityStates | undefined>(undefined);

/** Its value keeps its identity for the Workbench's life, so a reader doesn't re-render on a state change. */
export const ChangeActivityStateContext = createContext<ChangeActivityStates | undefined>(undefined);

/** Only the activity's own change function: the caller doesn't re-render when any activity's state changes. */
export const useChangeActivityState = (activityId: string): ActivityState["change"] => {
  const changeStates = useContext(ChangeActivityStateContext);
  if (changeStates === undefined) throw new Error("useChangeActivityState is used outside the Workbench; render the panel inside it.");
  return useCallback((change) => changeStates(activityId, change), [changeStates, activityId]);
};

/** For the activity's own panel: it re-renders on every activity's state change. */
export const useActivityState = (activityId: string): ActivityState => {
  const states = useContext(ActivityStateContext);
  if (states === undefined) throw new Error("useActivityState is used outside the Workbench; render the panel inside it.");
  const change = useChangeActivityState(activityId);
  const state = states[activityId];
  return useMemo(() => ({ state, change }), [state, change]);
};

/** While `ask` is given, a close of the tab (its X, Close, Ctrl+W) runs `ask` instead; the panel closes it itself. */
export const useCloseGuard = (tab: TabRef, ask: (() => void) | undefined): void => {
  const key = tabKey(tab.panelId, tab.params);
  useEffect(() => (ask === undefined ? undefined : closeGuards().guard(key, ask)), [key, ask]);
};
