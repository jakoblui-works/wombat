// The workbench's own commands: the actions its buttons and keys take, registered while the workbench is mounted.
import type { DockviewApi } from "dockview-react";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import type { ActivityDescriptor } from "../registry.ts";
import { setNewAgentDialogOpen } from "./new-agent-dialog.ts";
import { splitEmpty, type SplitDirection } from "../tabs.ts";
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
};

/** The ids of the workbench's commands the page's controls and menus name. */
export const WORKBENCH_COMMAND = { newAgent: "agent.new", closeTab: "view.closeTab", toggleRightSidebar: "view.toggleRightSidebar" } as const;

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
export const registerWorkbenchCommands = ({ api, activities, showActivity, toggleRightSidebar, rightSidebarTitle = "Right Sidebar", blocked }: WorkbenchCommandDeps): (() => void) => {
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
        else if (group !== undefined && group.panels.length === 0 && dockview.groups.length > 1) dockview.removeGroup(group);
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
    ...activities.map(({ id, title }) => registerCommand({ id: activityCommandId(id), title: `Show ${title}`, when: unblocked, run: () => showActivity(id) })),
  ];
  return () => {
    for (const off of unregister) off();
  };
};
