// What views may ask of the workbench they're shown in.
import { createContext, useContext } from "react";

export type WorkbenchActions = {
  /**
   * Opens (or focuses) the tab for this view and params in the editor area. `reveal` (a permission request's id)
   * reaches the tab's view as its `reveal` prop; it isn't part of the tab's identity.
   */
  openTab: (viewId: string, params: unknown, reveal?: string) => void;
  /** Closes the tab for this view and params, if it's open. */
  closeTab: (viewId: string, params: unknown) => void;
};

export const WorkbenchContext = createContext<WorkbenchActions | undefined>(undefined);

export const useWorkbench = (): WorkbenchActions => {
  const actions = useContext(WorkbenchContext);
  if (actions === undefined) throw new Error("useWorkbench is used outside the Workbench; render the view inside it.");
  return actions;
};

/** The tab that's active in the editor area (a view and its params); undefined while no tab is open. */
export type ActiveTab = { viewId: string; params: unknown };

export const ActiveTabContext = createContext<ActiveTab | undefined>(undefined);

/** The active tab, for a view that marks what's open (the agent list marks the active chat). */
export const useActiveTab = (): ActiveTab | undefined => useContext(ActiveTabContext);
