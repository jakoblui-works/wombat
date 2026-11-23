// The workbench's own commands: the actions its buttons and keys take, registered while the workbench is mounted.
import { wantNewChatFocus } from "./new-chat-focus.ts";
import { registerCommand } from "./registry.ts";

export type WorkbenchCommandDeps = {
  /** New Agent: shows the empty chat on the shown workspace. */
  newAgent: () => void;
  toggleLeftSidebar: () => void;
  /** Whether the connection banner has made the panels inert: no key may change them then. */
  blocked: () => boolean;
  /** Close Tab: closes the shown workspace's active tab, its guard asking first. */
  closeActiveTab: () => void;
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
  toggleLeftSidebar: "view.toggleLeftSidebar",
  restartService: "service.restart",
} as const;

/**
 * The left sidebar toggle's title and key, also its title bar button's name and `aria-keyshortcuts` (the button renders
 * before the command registers). VS Code's toggle for its primary side bar.
 */
export const TOGGLE_LEFT_SIDEBAR = { title: "Toggle Left Sidebar", keys: "ctrl+b" } as const;

/** Registers the workbench's commands; returns their unregistration. */
export const registerWorkbenchCommands = ({
  newAgent,
  toggleLeftSidebar,
  blocked,
  restartService,
  closeActiveTab,
  openFolder,
  chooseItemsFolder,
}: WorkbenchCommandDeps): (() => void) => {
  const unblocked = () => !blocked();
  const unregister = [
    registerCommand({
      id: WORKBENCH_COMMAND.newAgent,
      title: "New Agent…",
      when: unblocked,
      run: ({ keepFocus }) => {
        newAgent();
        if (keepFocus !== true) wantNewChatFocus();
      },
    }),
    registerCommand({ id: WORKBENCH_COMMAND.openFolder, title: "Open Folder…", when: unblocked, run: openFolder }),
    registerCommand({ id: WORKBENCH_COMMAND.chooseItemsFolder, title: "Choose Items Folder…", when: unblocked, run: chooseItemsFolder }),
    registerCommand({ id: WORKBENCH_COMMAND.closeTab, title: "Close Tab", keys: ["ctrl+w"], when: unblocked, run: closeActiveTab }),
    // Hiding the sidebar is harmless while the panels are inert, so it has no `when`: the key, menu and button agree.
    registerCommand({ id: WORKBENCH_COMMAND.toggleLeftSidebar, title: TOGGLE_LEFT_SIDEBAR.title, keys: [TOGGLE_LEFT_SIDEBAR.keys], run: toggleLeftSidebar }),
    // Restart works whatever the connection's state (it is the way out of a failed one), so it has no `when`.
    registerCommand({
      id: WORKBENCH_COMMAND.restartService,
      title: "Restart Service",
      run: () => {
        if (restartService !== undefined) restartService();
        else return window.wombat.service.restart();
      },
    }),
  ];
  return () => {
    for (const off of unregister) off();
  };
};
