import { expect, test } from "vitest";

import { MAIN_COMMAND_IDS } from "../../../../shared/bridge.ts";
import { type Command, commands, formatKeys, registerCommand } from "../commands/registry.ts";
import { WORKBENCH_COMMAND } from "../commands/workbench-commands.ts";
import { MENUS, menuItems } from "./menus.ts";

const noop = () => undefined;

test("a menu's items are its registered commands by id, with the command's title and keys", () => {
  const menu = { label: "Test", entries: [{ id: "test.menu.keyed" }, "separator", { id: "test.menu.shown" }, { id: "test.menu.bare" }] } as const;
  const registered: Command[] = [
    { id: "test.menu.keyed", title: "Keyed", keys: ["ctrl+alt+k"], run: noop },
    { id: "test.menu.shown", title: "Shown", shownKeys: ["ctrl+z"], run: noop },
    { id: "test.menu.bare", title: "Bare", run: noop },
  ];
  expect(menuItems(menu, registered)).toEqual([
    { separator: false, id: "test.menu.keyed", label: "Keyed", keys: "Ctrl+Alt+K", disabled: false },
    { separator: true },
    { separator: false, id: "test.menu.shown", label: "Shown", keys: "Ctrl+Z", disabled: false },
    { separator: false, id: "test.menu.bare", label: "Bare", keys: undefined, disabled: false },
  ]);
});

test("an item whose command's when() is false is disabled, and enabled again when it holds", () => {
  let held = false;
  const registered: Command[] = [{ id: "test.menu.gated", title: "Gated", when: () => held, run: noop }];
  const menu = { label: "Test", entries: [{ id: "test.menu.gated" }] } as const;
  const disabled = () => menuItems(menu, registered).map((item) => !item.separator && item.disabled);
  expect(disabled()).toEqual([true]);
  held = true;
  expect(disabled()).toEqual([false]);
});

test("an entry for an unregistered id fails loudly, naming the menu and the id", () => {
  expect(() => menuItems({ label: "Test", entries: [{ id: "test.menu.nobody" }] }, [])).toThrow(/Test menu.*"test\.menu\.nobody"/);
});

test("the real menus resolve once the workbench's commands are registered, and Edit shows each command's keys", () => {
  // The workbench's own commands register while it is mounted; here they stand in.
  for (const id of [WORKBENCH_COMMAND.newAgent, WORKBENCH_COMMAND.toggleRightSidebar]) registerCommand({ id, title: id, run: noop });
  const mainIds = new Set<string>(MAIN_COMMAND_IDS);
  for (const menu of MENUS) {
    const items = menuItems(menu);
    expect(items.length).toBe(menu.entries.length);
    for (const entry of menu.entries) if (entry !== "separator" && mainIds.has(entry.id)) expect(items.some((item) => !item.separator && item.id === entry.id)).toBe(true);
  }
  const edit = menuItems(MENUS.find(({ label }) => label === "Edit")!).flatMap((item) => (item.separator ? [] : [item]));
  expect(edit.length).toBeGreaterThan(0);
  for (const item of edit) {
    const command = commands().find(({ id }) => id === item.id)!;
    expect(item.keys, item.id).toBeDefined();
    expect(item.keys, item.id).toBe(formatKeys(command));
  }
});
