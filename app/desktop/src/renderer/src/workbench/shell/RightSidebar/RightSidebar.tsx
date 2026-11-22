import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { useAgents, useProposals } from "../../../data/hooks.ts";
import { type ActivityDescriptor, activities, getPanel, isKnown, type NavigatorParams, type ResolveContext } from "../../registry.ts";
import { closeGuards, type Reveals, sidebarRevealKey, tabKey } from "../../tabs.ts";
import { ActiveTabContext } from "../../workbench-context.ts";
import {
  allTabs,
  hideNavigator,
  keepTab,
  navigatorToggle,
  pruneTabs,
  RIGHT_START_WIDTH,
  rightView,
  shownNavigator,
  shownTab,
  tabWorkspace,
  type TabEntry,
  type WorkspaceShell,
} from "../shell-state.ts";
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

const NavigatorToggle = ({ workspace }: { workspace: string }) => {
  const { state, change } = useShell();
  const offers = navigatorToggle(state, workspace);
  if (offers === undefined) return null;
  const label = offers === "hide" ? "Hide navigator" : "Show navigator";
  const Icon = offers === "hide" ? PanelRightClose : PanelRightOpen;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="focus-ring mx-1 flex size-7 shrink-0 items-center justify-center self-center rounded-md text-fg-tertiary hover:bg-surface-2 hover:text-fg-primary"
      onClick={() => change((current) => hideNavigator(current, workspace, offers === "hide"))}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
};

const Navigator = ({ workspace, activity, visible, alone, shown, reveals }: Pick<Stores, "reveals"> & { workspace: string; activity: ActivityDescriptor; visible: boolean; alone: boolean; shown: boolean }) => {
  const key = sidebarRevealKey(activity.navigator);
  // A hidden navigator would end the reveal unseen (display:none rows can't scroll or focus), so it waits until shown.
  const reveal = useSyncExternalStore(reveals.subscribe, () => (shown && visible ? reveals.get(key) : undefined));
  const onRevealed = useCallback(() => reveals.forget(key), [reveals, key]);
  const params = useMemo<NavigatorParams>(() => ({ ws: workspace }), [workspace]);
  const Panel = getPanel(activity.navigator)?.component;
  return (
    <aside
      aria-label={activity.title}
      hidden={!visible}
      className={cn("flex min-h-0 min-w-0 flex-col bg-surface-0", alone ? "flex-1" : "w-60 shrink-0 border-l border-line")}
    >
      {Panel === undefined ? null : <Panel params={params} reveal={reveal} onRevealed={onRevealed} />}
    </aside>
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
  const active = shownTab(state, workspace);
  const navigator = shownNavigator(state, workspace);
  const activeTab = useMemo(() => (active === undefined || !shown ? undefined : { panelId: active.panelId, params: active.params }), [active, shown]);
  return (
    <WorkspaceActivityStates workspace={workspace}>
      <ActiveTabContext value={activeTab}>
        <div hidden={!shown} className="flex min-h-0 flex-1 flex-col">
          {shell.tabs.length === 0 ? null : (
            <div className="flex h-tab-strip shrink-0 border-b border-line bg-surface-0">
              <TabStrip workspace={workspace} strip={strip} shown={shown && open} titles={stores.titles} ctx={ctx} />
              <NavigatorToggle workspace={workspace} />
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <div hidden={active === undefined} className="flex min-w-0 flex-1 flex-col">
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
            {activities().map((activity) => (
              <Navigator
                key={activity.id}
                workspace={workspace}
                activity={activity}
                visible={navigator === activity.id}
                alone={active === undefined}
                shown={shown}
                reveals={stores.reveals}
              />
            ))}
          </div>
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

/** The right sidebar: each workspace's tab strip, tabs and navigators, the shown workspace's alone visible. */
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
