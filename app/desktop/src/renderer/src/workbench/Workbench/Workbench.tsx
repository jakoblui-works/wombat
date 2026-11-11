import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import { PanelRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAgents } from "../../data/hooks.ts";
import { AGENTS_ACTIVITY } from "../activities.ts";
import { defaultLayout, restoreLayout, type SavedLayout } from "../layout.ts";
import { dockviewChange, type LayoutSaver, layoutSaver } from "../layout-saver.ts";
import type { OpenAgents } from "../open-agents.ts";
import { activities, getActivity, getView, isKnown, viewsFor } from "../registry.ts";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle.tsx";
import { openTab, TAB_COMPONENT, type TabParams } from "../tabs.ts";
import { type WorkbenchActions, WorkbenchContext } from "../workbench-context.ts";

type Chrome = Pick<SavedLayout, "sidebars" | "activity">;

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 800;

const clampWidth = (width: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

const TabContent = ({ params }: IDockviewPanelProps<TabParams>) => {
  const View = getView(params.viewId)?.component;
  return View === undefined ? null : <View params={params.params} />;
};
const COMPONENTS = { [TAB_COMPONENT]: TabContent };

/** The settings' saved layout once read; `readable: false` when they couldn't be read (nothing is saved then). */
type SavedRead = { raw: unknown; readable: boolean };

/**
 * The window: activity bar, left sidebar (the activity's view), the editor's tabs (dockview) and the right sidebar.
 * The layout is restored once, after the first agents list arrived or failed (so tabs of deleted agents drop out),
 * and only saved after that.
 */
export const Workbench = ({ openAgents }: { openAgents: OpenAgents }) => {
  const agents = useAgents();
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

  const agentsSettled = !agents.isPending;
  const agentList = agents.data?.agents;
  // Whether the restore fell back to the default although a layout was saved; only a user change may replace it then.
  const fellBack = useRef(false);
  useEffect(() => {
    if (api === undefined || saved === undefined || !agentsSettled || restored === api) return;
    fellBack.current = false;
    const layout = restoreLayout(saved.raw, isKnown({ agents: agentList }), (dockview) => api.fromJSON(dockview), () => {
      fellBack.current = true;
    });
    setChrome({ sidebars: layout.sidebars, activity: layout.activity });
    setRestored(api);
  }, [api, saved, agentsSettled, agentList, restored]);

  const ready = api !== undefined && restored === api;

  // Made after the restore, so nothing the restore itself changes is saved; dockview's layout events fired before
  // the subscription (fromJSON's) never reach it.
  const saver = useRef<LayoutSaver | undefined>(undefined);
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
    const changes = api.onDidLayoutChange(({ reasons }) => current.schedule(dockviewChange(reasons)));
    // A reload (a workspace switch) unloads the page after main has moved on: no save may happen from then on.
    const unloading = () => current.stop();
    window.addEventListener("beforeunload", unloading);
    return () => {
      changes.dispose();
      window.removeEventListener("beforeunload", unloading);
      current.stop();
      if (saver.current === current) saver.current = undefined;
    };
  }, [ready, api, saved]);

  /** A change the user made to the sidebars or the activity. */
  const changeChrome = (change: (current: Chrome) => Chrome) => {
    setChrome(change);
    // Saved after the delay, by which time the change has rendered into chromeRef.
    saver.current?.schedule("user");
  };

  // Requests queued before the restore are applied right after it, so the restore can't replace their tabs.
  useEffect(() => {
    if (!ready) return;
    return openAgents.open((agentId) => {
      setChrome((current) => ({ ...current, activity: AGENTS_ACTIVITY }));
      saver.current?.schedule("user");
      openTab(api, "chat", { agentId });
    });
  }, [ready, api, openAgents]);

  const actions = useMemo<WorkbenchActions>(
    () => ({
      openTab: (viewId, params) => {
        if (api !== undefined) openTab(api, viewId, params);
      },
    }),
    [api],
  );

  const activity = getActivity(chrome.activity) ?? activities()[0];
  const Sidebar = activity === undefined ? undefined : getView(activity.sidebarView)?.component;
  const rightViews = viewsFor("right");
  const resize = (side: "left" | "right", dx: number) =>
    changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, [side]: clampWidth(current.sidebars[side] + dx) } }));

  return (
    <WorkbenchContext value={actions}>
      <div className="flex h-screen w-screen overflow-hidden">
        <nav aria-label="Activities" className="flex shrink-0 flex-col">
          {activities().map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={id === activity?.id}
              onClick={() => changeChrome((current) => ({ ...current, activity: id }))}
            >
              <Icon />
            </button>
          ))}
          <button
            type="button"
            title="Right sidebar"
            aria-label="Right sidebar"
            aria-pressed={!chrome.sidebars.rightCollapsed}
            onClick={() => changeChrome((current) => ({ ...current, sidebars: { ...current.sidebars, rightCollapsed: !current.sidebars.rightCollapsed } }))}
          >
            <PanelRight />
          </button>
          <span className="mt-auto">
            API <span data-testid="api-version">{window.wombat.apiVersion}</span>
          </span>
        </nav>
        <aside aria-label={activity?.title} className="shrink-0 overflow-auto" style={{ width: chrome.sidebars.left }}>
          {Sidebar && <Sidebar params={{}} />}
        </aside>
        <ResizeHandle label="Resize the left sidebar" onDrag={(dx) => resize("left", dx)} />
        <div className="min-w-0 flex-1">
          <DockviewReact className="dockview-theme-dark" components={COMPONENTS} onReady={(event: DockviewReadyEvent) => setApi(event.api)} />
        </div>
        {!chrome.sidebars.rightCollapsed && (
          <>
            <ResizeHandle label="Resize the right sidebar" onDrag={(dx) => resize("right", -dx)} />
            <aside aria-label="Right sidebar" className="shrink-0 overflow-auto" style={{ width: chrome.sidebars.right }}>
              {rightViews.map(({ id, component: View }) => (
                <View key={id} params={{}} />
              ))}
            </aside>
          </>
        )}
      </div>
    </WorkbenchContext>
  );
};
