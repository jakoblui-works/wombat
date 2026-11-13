// The workbench's own commands: the actions its buttons and keys take, registered while the workbench is mounted.
import type { DockviewApi } from "dockview-react";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import type { ActivityDescriptor } from "../registry.ts";
import { setNewAgentDialogOpen } from "./new-agent-dialog.ts";
import { closeEmptyGroup, splitEmpty, type SplitDirection } from "../tabs.ts";
import { commands, registerCommand } from "./registry.ts";

export type WorkbenchCommandDeps = {
  /** Dockview's api; undefined until it's ready, when the tab commands do nothing. */
  api: () => DockviewApi | undefined;
  activities: readonly ActivityDescriptor[];
  showActivity: (id: string) => void;
  toggleRightSidebar: () => void;
  /** What the right sidebar shows, as the toggle's menu item names it (default "Right Sidebar"). */
  rightSidebarTitle?: string;
  /** Whether the connection banner has made the views inert: no key may change them then. */
  blocked: () => boolean;
  /** What Restart Service does (default: the bridge's restart); the page passes the one that tracks the attempt. */
  restartService?: () => void;
};

/** The ids of the workbench's commands the page's controls and menus name. */
export const WORKBENCH_COMMAND = { newAgent: "agent.new", closeTab: "view.closeTab", closeGroup: "view.closeGroup", toggleRightSidebar: "view.toggleRightSidebar", restartService: "service.restart" } as const;

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
export const registerWorkbenchCommands = ({ api, activities, showActivity, toggleRightSidebar, rightSidebarTitle = "Right Sidebar", blocked, restartService }: WorkbenchCommandDeps): (() => void) => {
  const unblocked = () => !blocked();
  const unregister = [
    registerCommand({
      id: WORKBENCH_COMMAND.newAgent,
      title: "New Agent…",
      when: unblocked,
      run: () => {
        showActivity(AGENTS_ACTIVITY);
        setNewAgentDialogOpen(true);
      },
    }),
    registerCommand({
      id: WORKBENCH_COMMAND.closeTab,
      title: "Close Tab",
      keys: ["ctrl+w"],
      when: unblocked,
      // Like VS Code's Ctrl+W: a group with no tab closes itself, except the last one.
      run: ({ groupId, panelId }) => {
        const dockview = api();
        if (dockview === undefined) return;
        if (panelId !== undefined) {
          const panel = dockview.getPanel(panelId);
          if (panel !== undefined) dockview.removePanel(panel);
          return;
        }
        const group = groupId === undefined ? dockview.activeGroup : dockview.getGroup(groupId);
        const panel = group?.activePanel;
        if (panel !== undefined) dockview.removePanel(panel);
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
    // VS Code's toggle for its secondary side bar.
    registerCommand({ id: WORKBENCH_COMMAND.toggleRightSidebar, title: `Toggle ${rightSidebarTitle}`, keys: ["ctrl+alt+b"], when: unblocked, run: toggleRightSidebar }),
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
