import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";

import { useAgents, useProposals } from "../../../data/hooks.ts";
import { getPanel, isKnown, type ResolveContext } from "../../registry.ts";
import { closeGuards, type Reveals, tabKey } from "../../tabs.ts";
import { ActiveTabContext } from "../../workbench-context.ts";
import { allTabs, keepTab, pruneTabs, RIGHT_START_WIDTH, rightView, tabWorkspace, type TabEntry, type WorkspaceShell } from "../shell-state.ts";
import { useShell } from "../ShellProvider.tsx";
import { WorkspaceActivityStates } from "../WorkspaceActivityStates.tsx";
import { tabElementIds } from "./tab-ids.ts";
import { TabStrip } from "./TabStrip.tsx";
import type { TabTitles } from "./tab-titles.ts";

type Stores = { reveals: Reveals; titles: TabTitles };

const TabContent = ({ tab, ids, shown, reveals, titles }: Stores & { tab: TabEntry; ids: { tab: string; panel: string }; shown: boolean }) => {
  const key = tabKey(tab.panelId, tab.params);
  const reveal = useSyncExternalStore(reveals.subscribe, () => reveals.get(key));
  const setTitle = useCallback((title: string) => titles.set(key, title), [titles, key]);
  const Panel = getPanel(tab.panelId)?.component;
  return (
    <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} hidden={!shown} className="flex min-h-0 flex-1 flex-col bg-surface-1">
      {Panel === undefined ? null : <Panel params={tab.params} reveal={reveal} setTitle={setTitle} />}
    </div>
  );
};

const WorkspaceTabs = ({
  workspace,
  shell,
  shown,
  open,
  ctx,
  ...stores
}: Stores & { workspace: string; shell: WorkspaceShell; shown: boolean; open: boolean; ctx: ResolveContext }) => {
  const { state } = useShell();
  const strip = useId();
  const view = rightView(state, workspace);
  const active = view.show === "tab" || view.show === "tab-and-navigator" ? view.tab : undefined;
  const activeTab = useMemo(() => (active === undefined || !shown ? undefined : { panelId: active.panelId, params: active.params }), [active, shown]);
  return (
    <WorkspaceActivityStates workspace={workspace}>
      <ActiveTabContext value={activeTab}>
        <div hidden={!shown} className="flex min-h-0 flex-1 flex-col">
          {shell.tabs.length === 0 ? null : <TabStrip workspace={workspace} strip={strip} shown={shown && open} titles={stores.titles} ctx={ctx} />}
          {shell.tabs.map((tab, at) => {
            const key = tabKey(tab.panelId, tab.params);
            return (
              <TabContent
                key={key}
                tab={tab}
                ids={tabElementIds(strip, at)}
                shown={active !== undefined && key === tabKey(active.panelId, active.params)}
                {...stores}
              />
            );
          })}
        </div>
      </ActiveTabContext>
    </WorkspaceActivityStates>
  );
};

/**
 * Keeps the tabs in step with the page: an edit keeps its tab, tabs whose agent or proposal no longer exists close,
 * and a closed tab's title is forgotten.
 */
const useTabUpkeep = (titles: TabTitles, ctx: ResolveContext): void => {
  const { state, change } = useShell();
  useEffect(
    () =>
      closeGuards().watch((key) =>
        change((current) => {
          const workspace = tabWorkspace(current, key);
          return workspace === undefined ? current : keepTab(current, workspace, key);
        }),
      ),
    [change],
  );
  const { agents, proposals } = ctx;
  useEffect(() => change((current) => pruneTabs(current, isKnown({ agents, proposals }))), [change, agents, proposals]);
  useEffect(() => titles.keepOnly(new Set(allTabs(state).map((tab) => tabKey(tab.panelId, tab.params)))), [titles, state]);
};

/** The right sidebar: each workspace's tab strip and tabs, the shown workspace's alone visible. */
export const RightSidebar = ({ shown, className, ...stores }: Stores & { shown: string | undefined; className: string }) => {
  const { state } = useShell();
  const agents = useAgents().data?.agents;
  const proposals = useProposals().data?.proposals;
  const ctx = useMemo<ResolveContext>(() => ({ agents, proposals }), [agents, proposals]);
  useTabUpkeep(stores.titles, ctx);
  const open = rightView(state, shown).show !== "closed";
  return (
    <aside aria-label="Tabs" hidden={!open} className={className} style={{ width: RIGHT_START_WIDTH }}>
      {Object.entries(state.workspaces).map(([workspace, shell]) => (
        <WorkspaceTabs key={workspace} workspace={workspace} shell={shell} shown={workspace === shown} open={open} ctx={ctx} {...stores} />
      ))}
    </aside>
  );
};
