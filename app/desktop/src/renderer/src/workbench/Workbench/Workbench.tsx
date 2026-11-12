import { type QueryState, useQueryClient } from "@tanstack/react-query";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";

import type { ListAgentsResponse } from "@wombat/shared/api";
import type { ConnectionState } from "../../../../shared/bridge.ts";
import { isSettled, NO_RESTART, restartAttempt, showsBanner } from "@/lib/connection-state";
import { cn } from "@/lib/utils";
import { useAgents, useConnection } from "../../data/hooks.ts";
import { keys } from "../../data/keys.ts";
import { AGENTS_ACTIVITY } from "../activities.ts";
import { defaultLayout, restoreLayout, type SavedLayout } from "../layout.ts";
import { type LayoutSaver, layoutSaver, pageChanges } from "../layout-saver.ts";
import type { OpenAgents } from "../open-agents.ts";
import { activities, activityOrDefault, getView, isKnown, isRestorable, viewsFor, viewTitle } from "../registry.ts";
import { ActivityBar } from "../ActivityBar/ActivityBar.tsx";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.tsx";
import { ConnectionIndicator } from "../ConnectionIndicator/ConnectionIndicator.tsx";
import { EmptyGroup } from "../EmptyGroup/EmptyGroup.tsx";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle.tsx";
import {
  pruneTabs,
  type Reveals,
  retitleTabs,
  revealStore,
  TAB_COMPONENT,
  type TabParams,
  tabTitles,
  withoutTitleChanges,
  workbenchActions,
} from "../tabs.ts";
import { TitleBar } from "../TitleBar/TitleBar.tsx";
import { type ActiveTab, ActiveTabContext, type WorkbenchActions, WorkbenchContext } from "../workbench-context.ts";

type Chrome = Pick<SavedLayout, "sidebars" | "activity">;

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 800;

const clampWidth = (width: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

const NO_REVEALS: Reveals = { get: () => undefined, subscribe: () => () => undefined };
const RevealsContext = createContext<Reveals>(NO_REVEALS);

const TitlesContext = createContext<ReturnType<typeof tabTitles>>(tabTitles());

const TabContent = ({ params, api }: IDockviewPanelProps<TabParams>) => {
  const reveals = useContext(RevealsContext);
  const reveal = useSyncExternalStore(reveals.subscribe, () => reveals.get(api.id));
  const titles = useContext(TitlesContext);
  const setTitle = useCallback((title: string) => titles.report(api, title), [titles, api]);
  useEffect(() => () => titles.forget(api.id), [titles, api]);
  const View = getView(params.viewId)?.component;
  return View === undefined ? null : <View params={params.params} reveal={reveal} setTitle={setTitle} />;
};
const COMPONENTS = { [TAB_COMPONENT]: TabContent };

/** The settings' saved layout once read; `readable: false` when they couldn't be read (nothing is saved then). */
type SavedRead = { raw: unknown; readable: boolean };

/**
 * Whether the agents read has an answer the restore can go by: the list, or a failure while connected, failed or
 * incompatible. A read refused while (re)connecting doesn't count: it's read again once connected.
 */
const agentsAnswered = (state: QueryState<ListAgentsResponse> | undefined, connection: ConnectionState["state"]): boolean =>
  state?.status === "success" ||
  (state?.status === "error" && state.fetchStatus === "idle" && (connection === "connected" || isSettled(connection)));

/**
 * The window: activity bar, left sidebar (the activity's view), the editor's tabs (dockview) and the right sidebar.
 * The layout is restored once, after the agents read was answered (so tabs of deleted agents drop out), and only saved
 * after that. From then on the tabs follow the agents list: the ones that no longer apply close, titles follow.
 */
export const Workbench = ({ openAgents }: { openAgents: OpenAgents }) => {
  const queryClient = useQueryClient();
  const agents = useAgents();
  const { state: connection, message: connectionMessage } = useConnection();
  const [api, setApi] = useState<DockviewApi>();
  const [saved, setSaved] = useState<SavedRead>();
  const [chrome, setChrome] = useState<Chrome>(() => {
    const { sidebars, activity } = defaultLayout();
    return { sidebars, activity };
  });
  const [restored, setRestored] = useState<DockviewApi>();
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;

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
  // Whether the restore fell back to the default although a layout was saved; only a user change may replace it then.
  const fellBack = useRef(false);
  useEffect(() => {
    if (api === undefined || saved === undefined || restored === api) return;
    // The cache's state, not the render's: a re-read starts the moment the connection is back.
    const state = queryClient.getQueryState<ListAgentsResponse>(keys.agents);
    if (!agentsAnswered(state, connection)) return;
    fellBack.current = false;
    const layout = restoreLayout(saved.raw, isRestorable({ agents: state?.data?.agents }), (dockview) => api.fromJSON(dockview), () => {
      fellBack.current = true;
    });
    setChrome({ sidebars: layout.sidebars, activity: layout.activity });
    setRestored(api);
  }, [api, saved, restored, queryClient, connection, agents.status, agents.fetchStatus]);

  const ready = api !== undefined && restored === api;

  // Made after the restore, so nothing the restore itself changes is saved; dockview's layout events fired before
  // the subscription (fromJSON's) never reach it.
  const saver = useRef<LayoutSaver | undefined>(undefined);
  const byThePage = useMemo(pageChanges, []);
  useEffect(() => {
    if (!ready || saved?.readable !== true) return;
    const current = layoutSaver(
      () => ({ version: 1, dockview: api.toJSON(), ...chromeRef.current }),
      (layout) => {
        window.wombat.settings.set({ layout }).catch(() => {
          console.warn("Wombat couldn't save the layout.");
        });
      },
    );
    if (!fellBack.current) current.arm();
    saver.current = current;
    const changes = api.onDidLayoutChange(({ reasons }) => current.schedule(byThePage.classify(withoutTitleChanges(reasons))));
    // A reload (a workspace switch) unloads the page after main has moved on: no save may happen from then on.
    const unloading = () => current.stop();
    window.addEventListener("beforeunload", unloading);
    return () => {
      changes.dispose();
      window.removeEventListener("beforeunload", unloading);
      current.stop();
      if (saver.current === current) saver.current = undefined;
    };
  }, [ready, api, saved, byThePage]);

  // The tabs follow the agents list, by the live rule (`isKnown`; the restore also asks `restores`); a change the page
  // makes, so it never arms the saver.
  const titles = useMemo(tabTitles, []);
  useEffect(() => {
    if (!ready) return;
    byThePage.run(() => {
      pruneTabs(api, isKnown({ agents: agentList }));
      retitleTabs(api, { agents: agentList }, (key) => titles.get(key));
    });
  }, [ready, api, agentList, byThePage, titles]);

  /** A change the user made to the sidebars or the activity. */
  const changeChrome = (change: (current: Chrome) => Chrome) => {
    setChrome(change);
    // Saved after the delay, by which time the change has rendered into chromeRef.
    saver.current?.schedule("user");
  };

  // The active tab, for views that mark what's open.
  const [activeTab, setActiveTab] = useState<ActiveTab>();
  useEffect(() => {
    if (api === undefined) return;
    const read = () => {
      const tab = api.activePanel?.params as Partial<TabParams> | undefined;
      setActiveTab(typeof tab?.viewId === "string" ? { viewId: tab.viewId, params: tab.params } : undefined);
    };
    read();
    const change = api.onDidActivePanelChange(read);
    return () => change.dispose();
  }, [api]);

  const reveals = useMemo(revealStore, []);
  const actions = useMemo<WorkbenchActions>(
    () =>
      api === undefined
        ? { openTab: () => undefined, openBeside: () => undefined, closeTab: () => undefined }
        : workbenchActions(api, reveals, () => ({ agents: agentsRef.current })),
    [api, reveals],
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
      setChrome((current) => ({ ...current, activity: AGENTS_ACTIVITY }));
      saver.current?.schedule("user");
      actions.openTab("chat", { agentId });
    });
  }, [ready, agentsKnown, openAgents, actions]);

  const activity = activityOrDefault(chrome.activity);
  const Sidebar = activity === undefined ? undefined : getView(activity.sidebarView)?.component;
  const rightViews = viewsFor("right");
  const rightView = rightViews[0] === undefined ? undefined : { title: viewTitle(rightViews[0], {}, { agents: undefined }), icon: rightViews[0].icon };
  const resize = (side: "left" | "right", dx: number) =>
    changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, [side]: clampWidth(current.sidebars[side] + dx) } }));

  // Whether the service was ever connected: the first `connecting` is the app starting, not a loss.
  const [connectedBefore, setConnectedBefore] = useState(false);
  if (connection === "connected" && !connectedBefore) setConnectedBefore(true);
  const blocked = showsBanner(connection, connectedBefore);

  // Kept here, not in the banner, which unmounts when the state moves (a first connecting) while a restart runs.
  const [attempt, dispatchAttempt] = useReducer(restartAttempt, NO_RESTART);
  useEffect(() => dispatchAttempt({ type: "connection", state: connection }), [connection]);
  const restart = () => {
    dispatchAttempt({ type: "start" });
    window.wombat.service.restart().then(
      () => dispatchAttempt({ type: "settled" }),
      (failure: unknown) =>
        dispatchAttempt({
          type: "rejected",
          error: `Couldn't restart the service${failure instanceof Error ? `: ${failure.message}` : ""}. Try Restart again.`,
        }),
    );
  };

  return (
    <WorkbenchContext value={actions}>
      <ActiveTabContext value={activeTab}>
        <RevealsContext value={reveals}>
          <TitlesContext value={titles}>
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
              <TitleBar
                right={rightView}
                rightOpen={!chrome.sidebars.rightCollapsed}
                onToggleRight={() =>
                  changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, rightCollapsed: !current.sidebars.rightCollapsed } }))
                }
              />
              {blocked ? <ConnectionBanner connection={connection} message={connectionMessage} attempt={attempt} onRestart={restart} /> : null}
              <div className="flex min-h-0 flex-1">
                <ActivityBar
                  activities={activities()}
                  active={activity?.id}
                  blocked={blocked}
                  onSelect={(id) => changeChrome((current) => ({ ...current, activity: id }))}
                >
                  <ConnectionIndicator connection={connection} />
                </ActivityBar>
                {/* Always here, so the views never remount: while blocked it is inert and the scrim over it shows. */}
                <div inert={blocked} className="relative flex min-w-0 flex-1">
                  <aside aria-label={activity?.title} className="flex shrink-0 flex-col overflow-x-hidden overflow-y-auto bg-surface-0" style={{ width: chrome.sidebars.left }}>
                    {Sidebar && <Sidebar params={{}} />}
                  </aside>
                  <ResizeHandle label="Resize the left sidebar" onDrag={(dx) => resize("left", dx)} />
                  <main className="min-w-0 flex-1">
                    <DockviewReact
                      className="dockview-theme-wombat"
                      components={COMPONENTS}
                      watermarkComponent={EmptyGroup}
                      onReady={(event: DockviewReadyEvent) => setApi(event.api)}
                    />
                  </main>
                  {!chrome.sidebars.rightCollapsed && (
                    <>
                      <ResizeHandle label="Resize the right sidebar" onDrag={(dx) => resize("right", -dx)} />
                      <aside aria-label={rightView?.title} className="flex shrink-0 flex-col overflow-x-hidden overflow-y-auto bg-surface-0" style={{ width: chrome.sidebars.right }}>
                        {rightViews.map(({ id, component: View }) => (
                          <View key={id} params={{}} />
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
              <span className="sr-only">
                Service API version <span data-testid="api-version">{window.wombat.apiVersion}</span>
              </span>
            </div>
          </TitlesContext>
        </RevealsContext>
      </ActiveTabContext>
    </WorkbenchContext>
  );
};
