// What views may ask of the workbench they're shown in.
import { createContext, useContext } from "react";

/** A tab: the view it shows and its params (its identity, with `tabKey`). */
export type TabRef = { viewId: string; params: unknown };

export type WorkbenchActions = {
  /**
   * Opens (or focuses) the tab for this view and params in the editor area. `reveal` (a permission request's id)
   * reaches the tab's view as its `reveal` prop; it isn't part of the tab's identity.
   */
  openTab: (viewId: string, params: unknown, reveal?: string) => void;
  /**
   * Opens (or focuses) the tab for this view and params beside the tab `beside`: in the group to the right of that
   * tab's group, or a new group there (the diff tab beside its chat).
   */
  openBeside: (viewId: string, params: unknown, beside: TabRef) => void;
  /** Closes the tab for this view and params, if it's open. */
  closeTab: (viewId: string, params: unknown) => void;
  /**
   * Switches to Agents, opens or focuses the agent's chat and reveals `requestId`; without one, the agent's oldest
   * pending permission, if any. A Needs me click and a notification click both come here.
   */
  openAgentChat: (agentId: string, requestId?: string) => void;
};

export const WorkbenchContext = createContext<WorkbenchActions | undefined>(undefined);

export const useWorkbench = (): WorkbenchActions => {
  const actions = useContext(WorkbenchContext);
  if (actions === undefined) throw new Error("useWorkbench is used outside the Workbench; render the view inside it.");
  return actions;
};

/** The tab that's active in the editor area; undefined while no tab is open. */
export type ActiveTab = TabRef;

export const ActiveTabContext = createContext<ActiveTab | undefined>(undefined);

/** The active tab, for a view that marks what's open (the agent list marks the active chat). */
export const useActiveTab = (): ActiveTab | undefined => useContext(ActiveTabContext);
