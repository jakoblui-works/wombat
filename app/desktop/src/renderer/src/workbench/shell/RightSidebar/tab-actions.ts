// The workbench's tab actions on the shell state: each workspace's strip in the right sidebar.
import { closeGuards, openablePanel, type revealStore, tabKey } from "../../tabs.ts";
import type { WorkbenchActions, WorkbenchContextValue } from "../../workbench-context.ts";
import { allTabs, closeTab, openTab, replaceTab, type ShellState, tabWorkspace } from "../shell-state.ts";
import type { TabTitles } from "./tab-titles.ts";

export type TabActionDeps = {
  /** The shell state and the shown workspace's id as the page knows them now. */
  current: () => { state: ShellState; shown: string | undefined };
  change: (update: (state: ShellState) => ShellState) => void;
  reveals: Pick<ReturnType<typeof revealStore>, "set">;
  titles: Pick<TabTitles, "set">;
};

export const shellTabActions = ({ current, change, reveals, titles }: TabActionDeps): WorkbenchActions & Pick<WorkbenchContextValue, "openTabs"> => ({
  openTab: (panelId, params, reveal, options) => {
    openablePanel(panelId, params);
    const { state, shown } = current();
    const workspace = options?.workspace ?? shown;
    if (workspace === undefined) return;
    const key = tabKey(panelId, params);
    const wasOpen = tabWorkspace(state, key, workspace) === workspace;
    if (!wasOpen && options?.title !== undefined) titles.set(key, options.title);
    change((before) => openTab(before, workspace, { panelId, params }, { temporary: options?.temporary === true, isDirty: closeGuards().unsaved }));
    // A new request each time, so the panel reveals again; a tab opened anew starts without an old one.
    if (reveal !== undefined) reveals.set(key, { target: reveal });
    else if (!wasOpen) reveals.set(key, undefined);
  },
  closeTab: (panelId, params) => {
    const key = tabKey(panelId, params);
    const { shown } = current();
    change((before) => {
      const workspace = tabWorkspace(before, key, shown);
      return workspace === undefined ? before : closeTab(before, workspace, key);
    });
  },
  replaceTab: (from, to) => {
    openablePanel(to.panelId, to.params);
    const key = tabKey(from.panelId, from.params);
    const { shown } = current();
    change((before) => {
      const workspace = tabWorkspace(before, key, shown) ?? shown;
      return workspace === undefined ? before : replaceTab(before, workspace, key, to);
    });
  },
  openTabs: (panelId) => allTabs(current().state).flatMap((tab) => (tab.panelId === panelId ? [{ panelId: tab.panelId, params: tab.params }] : [])),
});
