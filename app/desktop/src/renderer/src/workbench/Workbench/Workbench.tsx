import { type QueryState, useQueryClient } from "@tanstack/react-query";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelProps } from "dockview-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ListAgentsResponse } from "@wombat/shared/api";
import type { ListProposalsResponse } from "@wombat/shared/proposals";
import type { ConnectionState } from "../../../../shared/bridge.ts";
import { isSettled } from "@/lib/connection-state";
import { cn } from "@/lib/utils";
import { useAgents, useProposals } from "../../data/hooks.ts";
import { chooseItemsFolder, openFolder, showWorkspace, shownWorkspaceId } from "../../data/shown-workspace.ts";
import { keys } from "../../data/keys.ts";
// Registers the activities and their panels, which the workbench reads from the registry.
import "../activities.ts";
import { needsMeCount } from "../../data/needs-me.ts";
import { defaultLayout, layoutActivityStates, layoutToSave, pruneLayout, restoreLayout, type SavedLayout } from "../layout.ts";
import { type LayoutSaver, layoutSaver, pageChanges } from "../layout-saver.ts";
import type { OpenAgents } from "../open-agents.ts";
import { activities, activityOrDefault, getPanel, isKnown, isRestorable, isSaved, panelsFor, panelTitle } from "../registry.ts";
import { ActivityBar } from "../ActivityBar/ActivityBar.tsx";
import { runLogged } from "../commands/registry.ts";
import { activityCommandId, registerWorkbenchCommands } from "../commands/workbench-commands.ts";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.tsx";
import { LiveLaunchNotice } from "../LaunchNotice/LaunchNotice.tsx";
import { LiveStatusBar } from "../StatusBar/StatusBar.tsx";
import { EmptyGroup } from "../EmptyGroup/EmptyGroup.tsx";
import { SplitButton } from "../TabBar/SplitButton.tsx";
import { Tab } from "../TabBar/Tab.tsx";
import { TabBarMenu } from "../TabBar/TabBarMenu.tsx";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle.tsx";
import {
  closeGuards,
  keepAllTabs,
  pruneTabs,
  type Reveals,
  retitleTabs,
  revealStore,
  settleMovedTab,
  sidebarRevealKey,
  TAB_COMPONENT,
  type TabParams,
  tabTitles,
  withoutTitleChanges,
  workbenchActions,
} from "../tabs.ts";
import { TitleBar } from "../TitleBar/TitleBar.tsx";
import {
  type ActiveTab,
  ActiveTabContext,
  ActivityStateContext,
  type ActivityStates,
  ChangeActivityStateContext,
  type ChangeActivityStates,
  type WorkbenchActions,
  WorkbenchContext,
  type WorkbenchContextValue,
} from "../workbench-context.ts";
import { CHAT_PANEL } from "../agents/chat-params.ts";
import { clampWidth, LEFT_WIDTH, RIGHT_WIDTH } from "../shell/shell-state.ts";
import { useCommandKeys, useServiceChrome } from "../shell/service-chrome.ts";
import { tell, Toast } from "../Toast/Toast.tsx";
import { asError, asSentence } from "../../lib/errors.ts";

type Chrome = Pick<SavedLayout, "sidebars" | "activity">;


/** What the actions do before dockview is ready; typed, so a new member can't be missed. */
const NO_ACTIONS: WorkbenchActions & Pick<WorkbenchContextValue, "openTabs"> = {
  openTabs: () => [],
  openTab: () => undefined,
  closeTab: () => undefined,
  replaceTab: () => undefined,
};

const NO_REVEALS: Reveals = { get: () => undefined, forget: () => undefined, subscribe: () => () => undefined };
const RevealsContext = createContext<Reveals>(NO_REVEALS);

/** The left sidebar's panel, with what it was last asked to reveal until it has shown it. */
const SidebarContent = ({ panelId }: { panelId: string }) => {
  const reveals = useContext(RevealsContext);
  const key = sidebarRevealKey(panelId);
  const reveal = useSyncExternalStore(reveals.subscribe, () => reveals.get(key));
  const onRevealed = useCallback(() => reveals.forget(key), [reveals, key]);
  const Panel = getPanel(panelId)?.component;
  return Panel === undefined ? null : <Panel params={{}} reveal={reveal} onRevealed={onRevealed} />;
};

const TitlesContext = createContext<ReturnType<typeof tabTitles>>(tabTitles());

const TabContent = ({ params, api }: IDockviewPanelProps<TabParams>) => {
  const reveals = useContext(RevealsContext);
  const reveal = useSyncExternalStore(reveals.subscribe, () => reveals.get(api.id));
  const titles = useContext(TitlesContext);
  const setTitle = useCallback((title: string) => titles.report(api, title), [titles, api]);
  useEffect(() => () => titles.forget(api.id), [titles, api]);
  const Panel = getPanel(params.panelId)?.component;
  return Panel === undefined ? null : <Panel params={params.params} reveal={reveal} setTitle={setTitle} />;
};
const COMPONENTS = { [TAB_COMPONENT]: TabContent };

// Clipped, not hidden: a hidden overflow can still be scrolled by focus or scrollIntoView, which would take the
// sidebar's header out of view. Its panel owns the scroll.
const SIDEBAR = "flex shrink-0 flex-col overflow-clip bg-surface-0";

/** The settings' saved layout once read; `readable: false` when they couldn't be read (nothing is saved then). */
type SavedRead = { raw: unknown; readable: boolean };

/**
 * Whether a list read (the agents, the proposals) has an answer the restore can go by: the list, or a failure while
 * connected, failed or incompatible. A read refused while (re)connecting doesn't count: it's read again once connected.
 */
const readAnswered = (state: QueryState | undefined, connection: ConnectionState["state"]): boolean =>
  state?.status === "success" ||
  (state?.status === "error" && state.fetchStatus === "idle" && (connection === "connected" || isSettled(connection)));

/**
 * The window: activity bar, left sidebar (the activity's panel), the editor's tabs (dockview) and the right sidebar.
 * The layout is restored once, after the agents and proposals reads were answered (so tabs of deleted agents and
 * decided proposals drop out), and only saved after that. From then on the tabs follow both lists: the ones that no
 * longer apply close, titles follow.
 */
export const Workbench = ({ openAgents }: { openAgents: OpenAgents }) => {
  const queryClient = useQueryClient();
  const agents = useAgents();
  const proposals = useProposals();
  const { connection: connectionState, blocked, attempt, restart, noticeShown, dismissNotice } = useServiceChrome();
  const { state: connection, message: connectionMessage } = connectionState;
  const [api, setApi] = useState<DockviewApi>();
  const [saved, setSaved] = useState<SavedRead>();
  const [chrome, setChrome] = useState<Chrome>(() => {
    const { sidebars, activity } = defaultLayout();
    return { sidebars, activity };
  });
  const [activityStates, setActivityStates] = useState<ActivityStates>(() => layoutActivityStates(defaultLayout()));
  const [restored, setRestored] = useState<DockviewApi>();
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const activityStatesRef = useRef(activityStates);
  activityStatesRef.current = activityStates;

  useEffect(() => {
    let live = true;
    window.wombat.settings.get().then(
      (settings) => live && setSaved({ raw: settings.layout, readable: true }),
      (error: unknown) => {
        console.warn("Wombat couldn't read its settings; the layout opens as the default and isn't saved:", error);
        if (live) setSaved({ raw: undefined, readable: false });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const agentList = agents.data?.agents;
  const agentsRef = useRef(agentList);
  agentsRef.current = agentList;
  const proposalList = proposals.data?.proposals;
  const proposalsRef = useRef(proposalList);
  proposalsRef.current = proposalList;
  // Whether the restore fell back to the default although a layout was saved; only a user change may replace it then.
  const fellBack = useRef(false);
  useEffect(() => {
    if (api === undefined || saved === undefined || restored === api) return;
    // The cache's state, not the render's: a re-read starts the moment the connection is back.
    const state = queryClient.getQueryState<ListAgentsResponse>(keys.agents);
    const proposalsState = queryClient.getQueryState<ListProposalsResponse>(keys.proposals);
    if (!readAnswered(state, connection) || !readAnswered(proposalsState, connection)) return;
    fellBack.current = false;
    const layout = restoreLayout(saved.raw, isRestorable({ agents: state?.data?.agents, proposals: proposalsState?.data?.proposals }), (dockview) => {
      keepAllTabs();
      api.fromJSON(dockview);
    }, () => {
      fellBack.current = true;
    });
    setChrome({ sidebars: layout.sidebars, activity: layout.activity });
    setActivityStates(layoutActivityStates(layout));
    setRestored(api);
  }, [api, saved, restored, queryClient, connection, agents.status, agents.fetchStatus, proposals.status, proposals.fetchStatus]);

  const ready = api !== undefined && restored === api;

  // Made after the restore, so nothing the restore itself changes is saved; dockview's layout events fired before
  // the subscription (fromJSON's) never reach it.
  const saver = useRef<LayoutSaver | undefined>(undefined);
  const byThePage = useMemo(pageChanges, []);
  useEffect(() => {
    if (!ready || saved?.readable !== true) return;
    const current = layoutSaver(
      () => pruneLayout(layoutToSave(api.toJSON(), chromeRef.current, activityStatesRef.current), isSaved),
      (layout) => {
        window.wombat.settings.set({ layout }).catch(() => {
          console.warn("Wombat couldn't save the layout.");
        });
      },
    );
    if (!fellBack.current) current.arm();
    saver.current = current;
    const changes = api.onDidLayoutChange(({ reasons }) => current.schedule(byThePage.classify(withoutTitleChanges(reasons))));
    // A reload unloads the page: no save may happen from then on.
    const unloading = () => current.stop();
    window.addEventListener("beforeunload", unloading);
    return () => {
      changes.dispose();
      window.removeEventListener("beforeunload", unloading);
      current.stop();
      if (saver.current === current) saver.current = undefined;
    };
  }, [ready, api, saved, byThePage]);

  // The tabs follow the agents and proposals lists, by the live rule (`isKnown`; the restore also asks `restores`); a change the page
  // makes, so it never arms the saver.
  const titles = useMemo(tabTitles, []);
  useEffect(() => {
    if (!ready) return;
    byThePage.run(() => {
      pruneTabs(api, isKnown({ agents: agentList, proposals: proposalList }));
      retitleTabs(api, { agents: agentList, proposals: proposalList }, (key) => titles.get(key));
    });
  }, [ready, api, agentList, proposalList, byThePage, titles]);

  /** A change the user made to the sidebars or the activity. */
  const changeChrome = (change: (current: Chrome) => Chrome) => {
    setChrome(change);
    // Saved after the delay, by which time the change has rendered into chromeRef.
    saver.current?.schedule("user");
  };

  // The active tab, for panels that mark what's open.
  const [activeTab, setActiveTab] = useState<ActiveTab>();
  useEffect(() => {
    if (api === undefined) return;
    const read = () => {
      const tab = api.activePanel?.params as Partial<TabParams> | undefined;
      setActiveTab(typeof tab?.panelId === "string" ? { panelId: tab.panelId, params: tab.params } : undefined);
    };
    read();
    const change = api.onDidActivePanelChange(read);
    return () => change.dispose();
  }, [api]);

  useEffect(() => {
    if (api === undefined) return;
    const moved = api.onDidMovePanel(({ panel }) => settleMovedTab(panel));
    return () => moved.dispose();
  }, [api]);

  const reveals = useMemo(revealStore, []);
  const showActivity = useCallback((id: string) => {
    setChrome((current) => ({ ...current, activity: id }));
    saver.current?.schedule("user");
  }, []);
  const changeActivityStates = useCallback<ChangeActivityStates>((activityId, change) => {
    setActivityStates((current) => ({ ...current, [activityId]: change(current[activityId]) }));
    saver.current?.schedule("user");
  }, []);
  const titleContext = useCallback(() => ({ agents: agentsRef.current, proposals: proposalsRef.current }), []);
  const actions = useMemo(() => (api === undefined ? NO_ACTIONS : workbenchActions(api, reveals, titleContext)), [api, reveals, titleContext]);
  const workbench = useMemo<WorkbenchContextValue>(
    () => ({ ...actions, reveals, showActivity, titleContext }),
    [actions, reveals, showActivity, titleContext],
  );

  // Requests wait for the restore (which would replace their tabs) and for the agents list, so an id the service
  // doesn't list opens nothing.
  const agentsKnown = agentList !== undefined;
  useEffect(() => {
    if (!ready || !agentsKnown) return;
    return openAgents.open((agentId) => {
      if (!agentsRef.current?.some(({ id }) => id === agentId)) {
        // Without the id: the console may end up in a bug report.
        console.warn("Wombat was asked to open an agent the service doesn't list; nothing was opened.");
        return;
      }
      workbench.openTab(CHAT_PANEL, { agentId });
    });
  }, [ready, agentsKnown, openAgents, workbench]);

  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const rightPanels = panelsFor("navigator");
  const rightPanel = rightPanels[0] === undefined ? undefined : { title: panelTitle(rightPanels[0], {}, { agents: undefined }), icon: rightPanels[0].icon };
  // The workbench's commands, and the page's one key listener: every key binding runs through the registry.
  useEffect(
    () =>
      registerWorkbenchCommands({
        api: () => api,
        activities: activities(),
        showActivity,
        blocked: () => blockedRef.current,
        restartService: () => restartRef.current(),
        ...(api === undefined ? {} : { closePanel: (panel: IDockviewPanel) => closeGuards().close(api, panel) }),
        openFolder: () => openFolder(queryClient, showWorkspace).catch((error: unknown) => tell(`Wombat couldn't open the folder: ${asSentence(asError(error).message)}`)),
        chooseItemsFolder: () =>
          shownWorkspaceId(queryClient)
            .then(chooseItemsFolder)
            .catch((error: unknown) => tell(`Wombat couldn't choose the items folder: ${asSentence(asError(error).message)}`)),
      }),
    [api, showActivity, queryClient],
  );
  useCommandKeys();

  const activity = activityOrDefault(chrome.activity);
  const resize = (side: "left" | "right", dx: number) =>
    changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, [side]: clampWidth(current.sidebars[side] + dx, side === "left" ? LEFT_WIDTH : RIGHT_WIDTH) } }));

  return (
    <WorkbenchContext value={workbench}>
      <ActivityStateContext value={activityStates}>
        <ChangeActivityStateContext value={changeActivityStates}>
          <ActiveTabContext value={activeTab}>
            <RevealsContext value={reveals}>
              <TitlesContext value={titles}>
                <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
                  <TitleBar
                    right={rightPanel}
                    count={agentList === undefined ? 0 : needsMeCount(agentList, proposals.data?.proposals ?? [])}
                    rightOpen={!chrome.sidebars.rightCollapsed}
                    onToggleRight={() =>
                      changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, rightCollapsed: !current.sidebars.rightCollapsed } }))
                    }
                  />
                  {blocked ? <ConnectionBanner connection={connection} message={connectionMessage} attempt={attempt} onRestart={restart} /> : null}
                  {!noticeShown ? null : (
                    <LiveLaunchNotice connection={connectionState} onRestart={restart} onDismiss={dismissNotice} />
                  )}
                  <div className="flex min-h-0 flex-1">
                    <ActivityBar
                      activities={activities()}
                      active={activity?.id}
                      blocked={blocked}
                      onSelect={(id) => runLogged(activityCommandId(id))}
                    />
                    {/* Always here, so the panels never remount: while blocked it is inert and the scrim over it shows. */}
                    <div inert={blocked} className="relative flex min-w-0 flex-1">
                      <aside aria-label={activity?.title} className={SIDEBAR} style={{ width: chrome.sidebars.left }}>
                        {activity === undefined ? null : <SidebarContent panelId={activity.navigator} />}
                      </aside>
                      <ResizeHandle label="Resize the left sidebar" onDrag={(dx) => resize("left", dx)} />
                      <main className="min-w-0 flex-1">
                        <TabBarMenu api={api}>
                          <DockviewReact
                            className="dockview-theme-wombat"
                            components={COMPONENTS}
                            defaultTabComponent={Tab}
                            rightHeaderActionsComponent={SplitButton}
                            watermarkComponent={EmptyGroup}
                            onReady={(event: DockviewReadyEvent) => setApi(event.api)}
                          />
                        </TabBarMenu>
                      </main>
                      {!chrome.sidebars.rightCollapsed && (
                        <>
                          <ResizeHandle label="Resize the right sidebar" onDrag={(dx) => resize("right", -dx)} />
                          <aside aria-label={rightPanel?.title} className={SIDEBAR} style={{ width: chrome.sidebars.right }}>
                            {rightPanels.map(({ id, component: Panel }) => (
                              <Panel key={id} params={{}} />
                            ))}
                          </aside>
                        </>
                      )}
                      <div
                        aria-hidden
                        className={cn("pointer-events-none absolute inset-0 z-20 bg-scrim transition-opacity", blocked ? "opacity-100" : "opacity-0")}
                      />
                    </div>
                  </div>
                  <LiveStatusBar connection={connectionState} agents={agentList} />
                  <Toast />
                  <span className="sr-only">
                    Service API version <span data-testid="api-version">{window.wombat.apiVersion}</span>
                  </span>
                </div>
              </TitlesContext>
            </RevealsContext>
          </ActiveTabContext>
        </ChangeActivityStateContext>
      </ActivityStateContext>
    </WorkbenchContext>
  );
};
