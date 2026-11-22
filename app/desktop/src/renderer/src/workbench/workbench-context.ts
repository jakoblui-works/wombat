// What panels may ask of the workbench they're shown in.
import { createContext, useContext, useEffect } from "react";

import type { DeskLayout } from "./layout.ts";
import { closeGuards, type OpenTabOptions, tabKey } from "./tabs.ts";

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
  /** The open tabs on item `itemId`, whichever binder each was opened from (its file may have moved since). */
  itemTabs: (itemId: string) => TabRef[];
  /**
   * Switches to Agents, opens or focuses the agent's chat and reveals `requestId`; without one, the agent's oldest
   * pending permission, if any. A Needs me click and a notification click both come here.
   */
  openAgentChat: (agentId: string, requestId?: string) => void;
  /** Opens or focuses the proposal's tab (a Needs me row's click). */
  openProposal: (proposalId: string) => void;
  /**
   * Switches to the Desk and shows the binder in its sidebar on its view `view` (else its first), else as a list of its
   * items. `reveal` (a proposal id or an item id) reaches the Desk's sidebar.
   */
  openBinder: (binderId: string, reveal?: string, view?: string) => void;
  /**
   * Opens or focuses the item's tab. A `temporary` tab takes the place of its group's temporary tab and is replaced by
   * the next one, until it's kept (`keepTab`); a tab opened again without it is kept.
   */
  openItem: (binderId: string, itemId: string, options?: OpenOptions) => void;
  /**
   * Shows the item (`ref`: its id or a handle) where it sits: the Desk's sidebar on its binder's first view, the item's
   * row revealed, and the item in a temporary tab. For a ref that names no item, opens nothing and tells the user.
   */
  followItem: (ref: string) => void;
  /** Opens a new tab on an item not written yet in the binder, starting with `context`'s values (`viewContext`). */
  openNewItem: (binderId: string, context: Record<string, unknown>) => void;
  /**
   * Opens tab `to` where tab `from` is (same group, same position) and closes `from` without asking its close guard;
   * with `from` not open, opens `to` as openTab does.
   */
  replaceTab: (from: TabRef, to: TabRef) => void;
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

/** While `ask` is given, a close of the tab (its X, Close, Ctrl+W) runs `ask` instead; the panel closes it itself. */
export const useCloseGuard = (tab: TabRef, ask: (() => void) | undefined): void => {
  const key = tabKey(tab.panelId, tab.params);
  useEffect(() => (ask === undefined ? undefined : closeGuards().guard(key, ask)), [key, ask]);
};
