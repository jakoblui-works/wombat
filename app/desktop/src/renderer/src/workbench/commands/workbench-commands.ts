// The workbench's own commands: the actions its buttons and keys take, registered while the workbench is mounted.
import type { DockviewApi } from "dockview-react";

import { AGENTS_ACTIVITY } from "../activity-ids.ts";
import type { ActivityDescriptor } from "../registry.ts";
import { setNewAgentDialogOpen } from "./new-agent-dialog.ts";
import { registerCommand } from "./registry.ts";

export type WorkbenchCommandDeps = {
  /** Dockview's api; undefined until it's ready, when the tab commands do nothing. */
  api: () => DockviewApi | undefined;
  activities: readonly ActivityDescriptor[];
  showActivity: (id: string) => void;
  toggleRightSidebar: () => void;
  /** Whether the connection banner has made the views inert: no key may change them then. */
  blocked: () => boolean;
};

/** The id of the command that shows activity `id`. */
export const activityCommandId = (id: string): string => `view.activity.${id}`;

/** Registers the workbench's commands; returns their unregistration. */
export const registerWorkbenchCommands = ({ api, activities, showActivity, toggleRightSidebar, blocked }: WorkbenchCommandDeps): (() => void) => {
  const unblocked = () => !blocked();
  const unregister = [
    registerCommand({
      id: "agent.new",
      title: "New Agent…",
      when: unblocked,
      run: () => {
        showActivity(AGENTS_ACTIVITY);
        setNewAgentDialogOpen(true);
      },
    }),
    registerCommand({
      id: "view.closeTab",
      title: "Close Tab",
      keys: ["ctrl+w"],
      when: unblocked,
      run: ({ panelId }) => {
        const dockview = api();
        const panel = panelId === undefined ? dockview?.activePanel : dockview?.getPanel(panelId);
        if (panel !== undefined) dockview?.removePanel(panel);
      },
    }),
    // VS Code's toggle for its secondary side bar.
    registerCommand({ id: "view.toggleRightSidebar", title: "Toggle Right Sidebar", keys: ["ctrl+alt+b"], when: unblocked, run: toggleRightSidebar }),
    ...activities.map(({ id, title }) => registerCommand({ id: activityCommandId(id), title: `Show ${title}`, when: unblocked, run: () => showActivity(id) })),
  ];
  return () => {
    for (const off of unregister) off();
  };
};
