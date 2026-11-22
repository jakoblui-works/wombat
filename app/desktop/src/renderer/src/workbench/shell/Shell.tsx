import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { useAgents, useProposals } from "../../data/hooks.ts";
import { chooseItemsFolder, openFolder } from "../../data/shown-workspace.ts";
import { asError, asSentence } from "../../lib/errors.ts";
// Registers the panels (the chat's among them) and the harnesses' UI.
import "../activities.ts";
import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import { CHAT_PANEL } from "../agents/chat-params.ts";
import { chatRevealKey, useOpenAgentChat } from "../agents/open-agent-chat.ts";
import { registerWorkbenchCommands } from "../commands/workbench-commands.ts";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.tsx";
import { EmptyState } from "../EmptyState/EmptyState.tsx";
import { LiveLaunchNotice } from "../LaunchNotice/LaunchNotice.tsx";
import type { OpenAgents } from "../open-agents.ts";
import { getActivity, getPanel } from "../registry.ts";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle.tsx";
import { LiveStatusBar } from "../StatusBar/StatusBar.tsx";
import { type Reveals, revealStore } from "../tabs.ts";
import { TitleBar } from "../TitleBar/TitleBar.tsx";
import { tell, Toast } from "../Toast/Toast.tsx";
import { WorkbenchContext, type WorkbenchContextValue } from "../workbench-context.ts";
import { RightSidebar } from "./RightSidebar/RightSidebar.tsx";
import { shellTabActions } from "./RightSidebar/tab-actions.ts";
import { tabTitleStore } from "./RightSidebar/tab-titles.ts";
import { useCommandKeys, useServiceChrome } from "./service-chrome.ts";
import { clampWidth, LEFT_START_WIDTH, LEFT_WIDTH, middleView, newChat, rightView } from "./shell-state.ts";
import { ShellProvider, useShell, useShownWorkspace } from "./ShellProvider.tsx";
import { WorkspaceActivityStates } from "./WorkspaceActivityStates.tsx";

// Clipped, not hidden: a hidden overflow can still be scrolled by focus or scrollIntoView, which would take the
// sidebar's header out of view. Its panel owns the scroll.
const SIDEBAR = "flex shrink-0 flex-col overflow-clip bg-surface-0";

/** The left sidebar's panel: the agents for now. */
const LeftPanel = () => {
  const sidebarPanel = getActivity(AGENTS_ACTIVITY)?.sidebarPanel;
  const Panel = sidebarPanel === undefined ? undefined : getPanel(sidebarPanel)?.component;
  return Panel === undefined ? null : <Panel params={{}} />;
};

const ShownChat = ({ agentId, reveals }: { agentId: string; reveals: Reveals }) => {
  const key = chatRevealKey(agentId);
  const reveal = useSyncExternalStore(reveals.subscribe, () => reveals.get(key));
  const Chat = getPanel(CHAT_PANEL)?.component;
  return Chat === undefined ? null : <Chat params={{ agentId }} reveal={reveal} />;
};

/** The open agent's chat, one at a time, or the empty chat. */
const Middle = ({ reveals }: { reveals: Reveals }) => {
  const { state } = useShell();
  const view = middleView(state, useAgents().data?.agents);
  // Keyed by the agent, so each agent's chat starts from its own state.
  if (view.show === "chat") return <ShownChat key={view.agentId} agentId={view.agentId} reveals={reveals} />;
  return <EmptyState symbol title="No agent open" body="Open an agent from the list, or start a new one." />;
};

/** Main's open-agent requests (a notification's click), once the agents list is read, so an unlisted id opens nothing. */
const OpenAgentRequests = ({ openAgents }: { openAgents: OpenAgents }) => {
  const openAgentChat = useOpenAgentChat();
  const agents = useAgents().data?.agents;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const agentsKnown = agents !== undefined;
  useEffect(() => {
    if (!agentsKnown) return;
    return openAgents.open((agentId) => {
      if (!agentsRef.current?.some(({ id }) => id === agentId)) {
        // Without the id: the console may end up in a bug report.
        console.warn("Wombat was asked to open an agent the service doesn't list; nothing was opened.");
        return;
      }
      openAgentChat(agentId);
    });
  }, [agentsKnown, openAgents, openAgentChat]);
  return null;
};

const Frame = ({ openAgents }: { openAgents: OpenAgents }) => {
  const queryClient = useQueryClient();
  const agents = useAgents().data?.agents;
  const { state, change } = useShell();
  const shown = useShownWorkspace();
  const { connection, blocked, attempt, restart, noticeShown, dismissNotice } = useServiceChrome();
  const [leftWidth, setLeftWidth] = useState(LEFT_START_WIDTH);

  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const shownRef = useRef(shown?.id);
  shownRef.current = shown?.id;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const restartRef = useRef(restart);
  restartRef.current = restart;

  const proposals = useProposals().data?.proposals;
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const stateRef = useRef(state);
  stateRef.current = state;

  const reveals = useMemo(revealStore, []);
  const titles = useMemo(tabTitleStore, []);
  const titleContext = useCallback(() => ({ agents: agentsRef.current, proposals: proposalsRef.current }), []);
  const workbench = useMemo<WorkbenchContextValue>(
    () => ({
      ...shellTabActions({ current: () => ({ state: stateRef.current, shown: shownRef.current }), change, reveals, titles }),
      reveals,
      showActivity: () => undefined,
      titleContext,
    }),
    [change, reveals, titles, titleContext],
  );

  useEffect(
    () =>
      registerWorkbenchCommands({
        api: () => undefined,
        activities: [],
        showActivity: () => undefined,
        toggleRightSidebar: () => undefined,
        blocked: () => blockedRef.current,
        restartService: () => restartRef.current(),
        openFolder: () =>
          openFolder(queryClient, (id) => change((current) => newChat(current, id))).catch((error: unknown) =>
            tell(`Wombat couldn't open the folder: ${asSentence(asError(error).message)}`),
          ),
        chooseItemsFolder: () =>
          chooseItemsFolder(queryClient, shownRef.current).catch((error: unknown) =>
            tell(`Wombat couldn't choose the items folder: ${asSentence(asError(error).message)}`),
          ),
      }),
    [queryClient, change],
  );
  useCommandKeys();

  const rightOpen = rightView(state, shown?.id).show !== "closed";

  return (
    <WorkbenchContext value={workbench}>
      <OpenAgentRequests openAgents={openAgents} />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
        <TitleBar right={undefined} rightOpen={rightOpen} onToggleRight={() => undefined} />
        {blocked ? <ConnectionBanner connection={connection.state} message={connection.message} attempt={attempt} onRestart={restart} /> : null}
        {noticeShown ? <LiveLaunchNotice connection={connection} onRestart={restart} onDismiss={dismissNotice} /> : null}
        {/* Always here, so the panels never remount: while blocked it is inert and the scrim over it shows. */}
        <div inert={blocked} className="relative flex min-h-0 min-w-0 flex-1">
          <WorkspaceActivityStates workspace={shown?.id}>
            <aside aria-label="Agents" className={SIDEBAR} style={{ width: leftWidth }}>
              <LeftPanel />
            </aside>
            <ResizeHandle label="Resize the left sidebar" onDrag={(dx) => setLeftWidth((width) => clampWidth(width + dx, LEFT_WIDTH))} />
            <main className="flex min-w-0 flex-1 flex-col">
              <Middle reveals={reveals} />
            </main>
          </WorkspaceActivityStates>
          <RightSidebar className={cn(SIDEBAR, "border-l border-line")} shown={shown?.id} reveals={reveals} titles={titles} />
          <div aria-hidden className={cn("pointer-events-none absolute inset-0 z-20 bg-scrim transition-opacity", blocked ? "opacity-100" : "opacity-0")} />
        </div>
        <LiveStatusBar connection={connection} agents={agents} />
        <Toast />
        <span className="sr-only">
          Service API version <span data-testid="api-version">{window.wombat.apiVersion}</span>
        </span>
      </div>
    </WorkbenchContext>
  );
};

/** The window: the title bar, the agents on the left, the open agent's chat in the middle, the right sidebar, the status bar. */
export const Shell = ({ openAgents }: { openAgents: OpenAgents }) => (
  <ShellProvider>
    <Frame openAgents={openAgents} />
  </ShellProvider>
);
