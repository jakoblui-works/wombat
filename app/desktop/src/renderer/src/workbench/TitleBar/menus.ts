// The title bar's menus as data: which command each item runs, by id. The component renders what `menuItems` resolves,
// so the registry stays the one place that knows a command's title and keys.
import { type Command, commands, formatKeys } from "../commands/registry.ts";
import { WORKBENCH_COMMAND } from "../commands/workbench-commands.ts";

/** A menu entry: a command by id, or a separator. */
export type MenuEntry = { id: string } | "separator";

export type MenuModel = { label: string; entries: readonly MenuEntry[] };

export const MENUS: readonly MenuModel[] = [
  {
    label: "File",
    entries: [{ id: WORKBENCH_COMMAND.newAgent }, { id: "workspace.switch" }, { id: "service.stop" }, { id: WORKBENCH_COMMAND.restartService }, "separator", { id: "app.quit" }],
  },
  {
    label: "Edit",
    entries: [{ id: "edit.undo" }, { id: "edit.redo" }, "separator", { id: "edit.cut" }, { id: "edit.copy" }, { id: "edit.paste" }, { id: "edit.selectAll" }],
  },
  {
    label: "View",
    entries: [{ id: "zoom.in" }, { id: "zoom.out" }, { id: "zoom.reset" }, "separator", { id: WORKBENCH_COMMAND.toggleRightSidebar }],
  },
  { label: "Window", entries: [{ id: "window.minimize" }, { id: "window.maximize" }, { id: "window.close" }] },
];

/** An entry resolved against the registry. */
export type MenuItem = { separator: true } | { separator: false; id: string; label: string; keys: string | undefined; disabled: boolean };

/**
 * The items of `menu`, with each command's title and keys; a command whose `when` is false (the views are inert behind
 * the connection banner) is disabled. Throws, naming the id, when a command isn't registered.
 */
export const menuItems = (menu: MenuModel, registered: readonly Command[] = commands()): MenuItem[] =>
  menu.entries.map((entry) => {
    if (entry === "separator") return { separator: true };
    const command = registered.find(({ id }) => id === entry.id);
    if (command === undefined) {
      throw new Error(`The ${menu.label} menu lists the command "${entry.id}", which isn't registered; register it or remove it from MENUS (TitleBar/menus.ts).`);
    }
    return { separator: false, id: command.id, label: command.title, keys: formatKeys(command), disabled: command.when?.() === false };
  });
