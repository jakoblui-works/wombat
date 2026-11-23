// The workbench's own commands: the actions its buttons and keys take, registered while the workbench is mounted.
import type { DockviewApi, IDockviewPanel } from "dockview-react";

import type { ActivityDescriptor } from "../registry.ts";
import { closeEmptyGroup, splitEmpty, type SplitDirection } from "../tabs.ts";
import { wantNewChatFocus } from "./new-chat-focus.ts";
import { commands, registerCommand } from "./registry.ts";

export type WorkbenchCommandDeps = {
  /** Dockview's api; undefined until it's ready, when the tab commands do nothing. */
  api: () => DockviewApi | undefined;
  activities: readonly ActivityDescriptor[];
  showActivity: (id: string) => void;
  /** New Agent: shows the empty chat on the shown workspace; without it (the old workbench) the command isn't registered. */
  newAgent?: () => void;
  /** Hides or shows the left sidebar; without it (the old workbench) the toggle isn't registered. */
  toggleLeftSidebar?: () => void;
  /** Whether the connection banner has made the panels inert: no key may change them then. */
  blocked: () => boolean;
  /** Closes a tab the user asked to close; a tab with unsaved work asks first (default: closes it). */
  closePanel?: (panel: IDockviewPanel) => void;
  /** Close Tab on the right sidebar's strip in place of dockview's: closes the shown workspace's active tab, its guard asking first. */
  closeActiveTab?: () => void;
  /** What Restart Service does (default: the bridge's restart); the page passes the one that tracks the attempt. */
  restartService?: () => void;
  /** Open Folder…: adds a workspace and shows it; tells its own failures. */
  openFolder: () => Promise<void>;
  /** Choose Items Folder…, for the shown workspace; tells its own failures. */
  chooseItemsFolder: () => Promise<void>;
};

/** The ids of the workbench's commands the page's controls and menus name. */
export const WORKBENCH_COMMAND = {
  newAgent: "agent.new",
  openFolder: "workspace.open",
  chooseItemsFolder: "items.chooseFolder",
  closeTab: "view.closeTab",
  closeGroup: "view.closeGroup",
  toggleLeftSidebar: "view.toggleLeftSidebar",
  restartService: "service.restart",
} as const;

/**
 * The left sidebar toggle's title and key, also its title bar button's name and `aria-keyshortcuts` (the button renders
 * before the command registers). VS Code's toggle for its primary side bar.
 */
export const TOGGLE_LEFT_SIDEBAR = { title: "Toggle Left Sidebar", keys: "ctrl+b" } as const;

/** The id of the command that shows activity `id`. */
export const activityCommandId = (id: string): string => `view.activity.${id}`;

/** The split directions in the order menus list them. */
export const SPLIT_DIRECTIONS: readonly SplitDirection[] = ["up", "down", "left", "right"];

const SPLIT_TITLES: Record<SplitDirection, string> = { right: "Split Right", down: "Split Down", left: "Split Left", up: "Split Up" };

/** The id of the command that splits towards `direction`. */
export const splitCommandId = (direction: SplitDirection): string => `view.split.${direction}`;

/** The title command `id` is registered with; the id itself while it isn't registered. */
export const commandTitle = (id: string): string => commands().find((command) => command.id === id)?.title ?? id;

/** Registers the workbench's commands; returns their unregistration. */
export const registerWorkbenchCommands = ({
  api,
  activities,
  showActivity,
  newAgent,
  toggleLeftSidebar,
  blocked,
  restartService,
  closePanel,
  closeActiveTab,
  openFolder,
  chooseItemsFolder,
}: WorkbenchCommandDeps): (() => void) => {
  const unblocked = () => !blocked();
  const unregister = [
    ...(newAgent === undefined
      ? []
      : [
          registerCommand({
            id: WORKBENCH_COMMAND.newAgent,
            title: "New Agent…",
            when: unblocked,
            run: () => {
              newAgent();
              wantNewChatFocus();
            },
          }),
        ]),
    registerCommand({ id: WORKBENCH_COMMAND.openFolder, title: "Open Folder…", when: unblocked, run: openFolder }),
    registerCommand({ id: WORKBENCH_COMMAND.chooseItemsFolder, title: "Choose Items Folder…", when: unblocked, run: chooseItemsFolder }),
    registerCommand({
      id: WORKBENCH_COMMAND.closeTab,
      title: "Close Tab",
      keys: ["ctrl+w"],
      when: unblocked,
      // Like VS Code's Ctrl+W: a group with no tab closes itself, except the last one.
      run: ({ groupId, panelId }) => {
        if (closeActiveTab !== undefined) {
          closeActiveTab();
          return;
        }
        const dockview = api();
        if (dockview === undefined) return;
        const close = closePanel ?? ((panel: IDockviewPanel) => dockview.removePanel(panel));
        if (panelId !== undefined) {
          const panel = dockview.getPanel(panelId);
          if (panel !== undefined) close(panel);
          return;
        }
        const group = groupId === undefined ? dockview.activeGroup : dockview.getGroup(groupId);
        const panel = group?.activePanel;
        if (panel !== undefined) close(panel);
        else if (group !== undefined) closeEmptyGroup(dockview, group.id);
      },
    }),
    registerCommand({
      id: WORKBENCH_COMMAND.closeGroup,
      title: "Close Group",
      when: unblocked,
      run: ({ groupId }) => {
        const dockview = api();
        const group = groupId ?? dockview?.activeGroup?.id;
        if (dockview !== undefined && group !== undefined) closeEmptyGroup(dockview, group);
      },
    }),
    ...SPLIT_DIRECTIONS.map((direction) =>
      registerCommand({
        id: splitCommandId(direction),
        title: SPLIT_TITLES[direction],
        when: unblocked,
        run: ({ groupId, panelId }) => {
          const dockview = api();
          if (dockview === undefined) return;
          splitEmpty(dockview, direction, groupId ?? (panelId === undefined ? undefined : dockview.getPanel(panelId)?.group.id));
        },
      }),
    ),
    // Hiding the sidebar is harmless while the panels are inert, so it has no `when`: the key, menu and button agree.
    ...(toggleLeftSidebar === undefined
      ? []
      : [registerCommand({ id: WORKBENCH_COMMAND.toggleLeftSidebar, title: TOGGLE_LEFT_SIDEBAR.title, keys: [TOGGLE_LEFT_SIDEBAR.keys], run: toggleLeftSidebar })]),
    // Restart works whatever the connection's state (it is the way out of a failed one), so it has no `when`.
    registerCommand({
      id: WORKBENCH_COMMAND.restartService,
      title: "Restart Service",
      run: () => {
        if (restartService !== undefined) restartService();
        else return window.wombat.service.restart();
      },
    }),
    ...activities.map(({ id, title }) => registerCommand({ id: activityCommandId(id), title: `Show ${title}`, when: unblocked, run: () => showActivity(id) })),
  ];
  return () => {
    for (const off of unregister) off();
  };
};
