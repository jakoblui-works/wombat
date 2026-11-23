import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { useAgents, useProposals, useWorkspaces } from "../../data/hooks.ts";
import { chooseItemsFolder } from "../../data/shown-workspace.ts";
import { asError, asSentence } from "../../lib/errors.ts";
// Registers the panels (the chat's among them) and the harnesses' UI.
import "../activities.ts";
import { AGENTS_PANEL, NEEDS_ME_PANEL } from "../activity-ids.ts";
import { CHAT_PANEL, MESSAGE_BOX, NEW_CHAT_PANEL } from "../agents/chat-params.ts";
import { chatRevealKey, useOpenAgentChat } from "../agents/open-agent-chat.ts";
import { openFolderOrTell } from "../commands/open-folder.ts";
import { registerWorkbenchCommands } from "../commands/workbench-commands.ts";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.tsx";
import { LiveLaunchNotice } from "../LaunchNotice/LaunchNotice.tsx";
import type { OpenAgents } from "../open-agents.ts";
import { activities, getPanel } from "../registry.ts";
import { RESIZE_HANDLE_WIDTH, ResizeHandle } from "../ResizeHandle/ResizeHandle.tsx";
import { LiveStatusBar } from "../StatusBar/StatusBar.tsx";
import { type Reveals, revealStore, tabKey } from "../tabs.ts";
import { TitleBar } from "../TitleBar/TitleBar.tsx";
import { tell, Toast } from "../Toast/Toast.tsx";
import { WorkbenchContext, type WorkbenchContextValue } from "../workbench-context.ts";
import { RightSidebar } from "./RightSidebar/RightSidebar.tsx";
import { requestClose, shellTabActions } from "./RightSidebar/tab-actions.ts";
import { tabTitleStore } from "./RightSidebar/tab-titles.ts";
import { useCommandKeys, useServiceChrome } from "./service-chrome.ts";
import { clampWidth, hideLeftSidebar, LEFT_START_WIDTH, leftBounds, middleView, newChat, rightView, showActivity as showActivityIn, shownTab } from "./shell-state.ts";
import { ShellProvider, useShell, useShownWorkspace } from "./ShellProvider.tsx";
import { Toolbar } from "./Toolbar/Toolbar.tsx";
import { useSavedShell } from "./use-saved-shell.ts";

// Clipped, not hidden: a hidden overflow can still be scrolled by focus or scrollIntoView, which would take the
// sidebar's header out of view. Its panel owns the scroll.
const SIDEBAR = "flex shrink-0 flex-col overflow-clip bg-surface-0";

const NO_WORKSPACE_SHOWN = "Wombat couldn't choose the items folder: no workspace is shown. Open one with File → Open Folder…, then try again.";

/** Where the focus goes as the left sidebar hides: when it's inside, to the message box, else the toggle; else it stays. */
const focusOnHide = (inside: boolean, message: HTMLElement | null, toggle: HTMLElement | null): HTMLElement | undefined =>
  inside ? (message ?? toggle ?? undefined) : undefined;

/** The left sidebar: Needs me above the overview. */
const LeftPanel = () => {
  const NeedsMe = getPanel(NEEDS_ME_PANEL)?.component;
  const Overview = getPanel(AGENTS_PANEL)?.component;
  return (
    <>
      {NeedsMe === undefined ? null : <NeedsMe params={{}} />}
      <div className="flex min-h-0 flex-1 flex-col">{Overview === undefined ? null : <Overview params={{}} />}</div>
    </>
  );
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
  const NewChat = getPanel(NEW_CHAT_PANEL)?.component;
  return NewChat === undefined ? null : <NewChat params={{}} />;
};

/**
 * Main's open-agent requests (a notification's click), once the saved shell is restored (it would replace the open
 * agent) and the agents list is read, so an unlisted id opens nothing.
 */
const OpenAgentRequests = ({ openAgents, restored }: { openAgents: OpenAgents; restored: boolean }) => {
  const openAgentChat = useOpenAgentChat();
  const agents = useAgents().data?.agents;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const agentsKnown = agents !== undefined;
  useEffect(() => {
    if (!restored || !agentsKnown) return;
    return openAgents.open((agentId) => {
      if (!agentsRef.current?.some(({ id }) => id === agentId)) {
        // Without the id: the console may end up in a bug report.
        console.warn("Wombat was asked to open an agent the service doesn't list; nothing was opened.");
        return;
      }
      openAgentChat(agentId);
    });
  }, [restored, agentsKnown, openAgents, openAgentChat]);
  return null;
};

/** The element's width, followed as the window or a neighbour resizes it. */
const useWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};

const Frame = ({ openAgents }: { openAgents: OpenAgents }) => {
  const queryClient = useQueryClient();
  const agents = useAgents().data?.agents;
  const { state, change } = useShell();
  const shown = useShownWorkspace();
  const { connection, blocked, attempt, restart, noticeShown, dismissNotice } = useServiceChrome();
  const restored = useSavedShell(connection.state);
  const [leftWidth, setLeftWidth] = useState(LEFT_START_WIDTH);
  const beside = useRef<HTMLDivElement>(null);
  const besideWidth = useWidth(beside);
  const row = useRef<HTMLDivElement>(null);
  const rowWidth = useWidth(row);
  const middle = useRef<HTMLElement>(null);
  const left = useRef<HTMLElement>(null);
  const leftToggle = useRef<HTMLButtonElement>(null);
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
  const workspaces = useWorkspaces().data?.workspaces;
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const stateRef = useRef(state);
  stateRef.current = state;

  const reveals = useMemo(revealStore, []);
  const titles = useMemo(tabTitleStore, []);
  const titleContext = useCallback(() => ({ agents: agentsRef.current, proposals: proposalsRef.current, workspaces: workspacesRef.current }), []);
  const showActivity = useCallback(
    (activityId: string, workspace?: string) => {
      const target = workspace ?? shownRef.current;
      if (target !== undefined) change((current) => showActivityIn(current, target, activityId));
    },
    [change],
  );
  const workbench = useMemo<WorkbenchContextValue>(
    () => ({
      ...shellTabActions({ current: () => ({ state: stateRef.current, shown: shownRef.current }), change, reveals, titles }),
      reveals,
      showActivity,
      titleContext,
    }),
    [change, reveals, titles, titleContext, showActivity],
  );

  useEffect(
    () =>
      registerWorkbenchCommands({
        api: () => undefined,
        activities: activities(),
        showActivity,
        newAgent: () => change((current) => newChat(current, shownRef.current)),
        toggleLeftSidebar: () => {
          if (!stateRef.current.leftHidden) {
            const inside = left.current?.contains(document.activeElement) === true;
            focusOnHide(inside, middle.current?.querySelector<HTMLElement>(MESSAGE_BOX) ?? null, leftToggle.current)?.focus();
          }
          change((current) => hideLeftSidebar(current, !current.leftHidden));
        },
        closeActiveTab: () => {
          const workspace = shownRef.current;
          const tab = shownTab(stateRef.current, workspace);
          if (workspace !== undefined && tab !== undefined) requestClose(change, workspace, tabKey(tab.panelId, tab.params));
        },
        blocked: () => blockedRef.current,
        restartService: () => restartRef.current(),
        openFolder: () =>
          openFolderOrTell(queryClient, (id) => change((current) => newChat(current, id))),
        chooseItemsFolder: async () => {
          const workspace = shownRef.current;
          if (workspace === undefined) {
            tell(NO_WORKSPACE_SHOWN);
            return;
          }
          await chooseItemsFolder(workspace).catch((error: unknown) =>
            tell(`Wombat couldn't choose the items folder: ${asSentence(asError(error).message)}`),
          );
        },
      }),
    [queryClient, change, showActivity],
  );
  useCommandKeys();

  const rightOpen = rightView(state, shown?.id).show !== "closed";

  return (
    <WorkbenchContext value={workbench}>
      <OpenAgentRequests openAgents={openAgents} restored={restored} />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg-primary">
        <TitleBar leftToggle={leftToggle} />
        {blocked ? <ConnectionBanner connection={connection.state} message={connection.message} attempt={attempt} onRestart={restart} /> : null}
        {noticeShown ? <LiveLaunchNotice connection={connection} onRestart={restart} onDismiss={dismissNotice} /> : null}
        {/* Always here, so the panels never remount: while blocked it is inert and the scrim over it shows. */}
        <div ref={row} inert={blocked} className="relative flex min-h-0 min-w-0 flex-1">
          {/* Hidden, not removed, so its panels keep their state while the chat takes the space. */}
          <aside ref={left} aria-label="Agents" hidden={state.leftHidden} className={SIDEBAR} style={{ width: leftWidth }}>
            <LeftPanel />
          </aside>
          {state.leftHidden ? null : (
            <ResizeHandle
              label="Resize the left sidebar"
              onDrag={(dx) => setLeftWidth((width) => clampWidth(width + dx, leftBounds(rowWidth - RESIZE_HANDLE_WIDTH * (rightOpen ? 2 : 1), rightOpen)))}
            />
          )}
          <div ref={beside} className="flex min-w-0 flex-1">
            <main ref={middle} className="relative flex min-w-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <Middle reveals={reveals} />
              </div>
              <Toolbar workspace={shown?.id} area={middle} />
            </main>
            <RightSidebar className={SIDEBAR} shown={shown?.id} available={besideWidth - RESIZE_HANDLE_WIDTH} reveals={reveals} titles={titles} />
          </div>
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
