// What panels may ask of the workbench they're shown in.
import { createContext, useContext } from "react";

import type { DeskLayout } from "./layout.ts";

/** A tab: the panel it shows and its params (its identity, with `tabKey`). */
export type TabRef = { panelId: string; params: unknown };

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
   * Switches to Agents, opens or focuses the agent's chat and reveals `requestId`; without one, the agent's oldest
   * pending permission, if any. A Needs me click and a notification click both come here.
   */
  openAgentChat: (agentId: string, requestId?: string) => void;
  /** Opens or focuses the proposal's tab (a Needs me row's click). */
  openProposal: (proposalId: string) => void;
  /**
   * Switches to the Desk and shows the binder in its sidebar on its view `view` (else its first) when that is a list or
   * a tree, else on its first view that isn't a board, else as a list of its items. When `view` (else the first view) is
   * a board, it also opens or focuses that board's tab, and `reveal` (a proposal id) reaches the board panel as its
   * `reveal` prop; otherwise `reveal` is ignored for now.
   */
  openBinder: (binderId: string, reveal?: string, view?: string) => void;
};

export const WorkbenchContext = createContext<WorkbenchActions | undefined>(undefined);

export const useWorkbench = (): WorkbenchActions => {
  const actions = useContext(WorkbenchContext);
  if (actions === undefined) throw new Error("useWorkbench is used outside the Workbench; render the panel inside it.");
  return actions;
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
