import { PanelLeft } from "lucide-react";
import { type Ref, useRef } from "react";

import { openedByPointer as byPointer } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { useNeedsMeCount, useWorkspaces } from "../../data/hooks.ts";
import { ariaKeyShortcut, runLogged } from "../commands/registry.ts";
import { TOGGLE_LEFT_SIDEBAR, WORKBENCH_COMMAND } from "../commands/workbench-commands.ts";
import { newChat } from "../shell/shell-state.ts";
import { useShell, useShownWorkspace } from "../shell/ShellProvider.tsx";
import { type MenuModel, MENUS, menuItems } from "./menus.ts";
import { WombatSymbol } from "../EmptyState/WombatSymbol.tsx";

/** The workspaces by name, the shown one checked; choosing one shows the empty chat on it. */
const WorkspaceEntries = () => {
  const listed = useWorkspaces().data?.workspaces ?? [];
  const shown = useShownWorkspace();
  const { change } = useShell();
  if (listed.length === 0) return null;
  return (
    <>
      <MenubarRadioGroup
        value={shown?.id ?? null}
        onValueChange={(id: unknown) => typeof id === "string" && id !== shown?.id && change((state) => newChat(state, id))}
      >
        {listed.map(({ id, name, root }) => (
          <MenubarRadioItem key={id} value={id} title={root}>
            {name}
          </MenubarRadioItem>
        ))}
      </MenubarRadioGroup>
      <MenubarSeparator />
    </>
  );
};

/**
 * A menu's items. A component of its own, so they resolve against the registry when the popup opens: the workbench
 * registers its commands after the title bar first renders.
 */
const MenuEntries = ({ menu, choose }: { menu: MenuModel; choose: (id: string) => void }) =>
  menuItems(menu).map((item, at) =>
    item.kind === "separator" ? (
      <MenubarSeparator key={`separator-${String(at)}`} />
    ) : item.kind === "workspaces" ? (
      <WorkspaceEntries key="workspaces" />
    ) : (
      <MenubarItem key={item.id} disabled={item.disabled} onClick={() => choose(item.id)}>
        {item.label}
        {item.keys === undefined ? null : <MenubarShortcut>{item.keys}</MenubarShortcut>}
      </MenubarItem>
    ),
  );

/** The left sidebar's toggle, pressed while the sidebar is shown; it runs the toggle's command, as its key does. */
const LeftSidebarToggle = ({ toggle }: { toggle: Ref<HTMLButtonElement> | undefined }) => {
  const shown = !useShell().state.leftHidden;
  const waiting = useNeedsMeCount() ?? 0;
  return (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={TOGGLE_LEFT_SIDEBAR.title}
      aria-keyshortcuts={ariaKeyShortcut(TOGGLE_LEFT_SIDEBAR.keys)}
      title={TOGGLE_LEFT_SIDEBAR.title}
      ref={toggle}
      onClick={() => runLogged(WORKBENCH_COMMAND.toggleLeftSidebar)}
      className={cn(
        "focus-ring relative flex size-7 items-center justify-center rounded-md text-fg-secondary transition-colors [app-region:no-drag] hover:bg-surface-2 hover:text-fg-primary",
        shown && "bg-surface-3 text-fg-primary",
      )}
    >
      <PanelLeft className="size-4" />
      {shown || waiting === 0 ? null : (
        <span
          aria-hidden
          data-needs-me-count
          className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-state-waiting px-1 text-[10px] leading-none font-semibold text-surface-0 tabular-nums"
        >
          {waiting}
        </span>
      )}
    </button>
  );
};

/**
 * The window's title bar, in place of the system's: the menus on the left, the symbol and workspace as the drag strip
 * in the middle, the left sidebar's toggle on the right, then the room the window controls (Electron's overlay) take.
 * The bar drags the window, so each control opts out of it with `no-drag`. `leftToggle` gets the toggle's element.
 */
export const TitleBar = ({ leftToggle }: { leftToggle?: Ref<HTMLButtonElement> }) => {
  const workspace = useShownWorkspace()?.name;
  // Edit commands (cut, paste, select all) act on the focused element, and opening a menu moves focus into the menubar.
  // So each time focus comes into the menubar from outside it (and outside its popups), it remembers where from. When
  // a menu closes, focus goes back there if the menu was opened with the pointer or a command was chosen (a menu
  // opened and dismissed from the keyboard stays on its trigger, where the user was).
  const menubar = useRef<HTMLDivElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  // Per menu, for the open that is under way: whether the pointer opened it; each open overwrites the last.
  const openedByPointer = useRef(new Map<string, boolean>());
  // The menus open now. Moving the mouse onto another trigger opens its menu and closes this one; focus must stay in
  // the bar then, or the menu just opened closes as focus leaves.
  const openMenus = useRef(new Set<string>());
  const chosen = useRef<string | undefined>(undefined);
  const inBar = (target: EventTarget | null) => target instanceof Node && menubar.current?.contains(target) === true;
  const inPopup = (target: EventTarget | null) => target instanceof Element && target.closest("[data-slot=menubar-content]") !== null;
  const rememberFocus = (event: React.FocusEvent) => {
    // React events cross the popup's portal; only focus arriving at the bar's own DOM counts.
    if (!inBar(event.target) || inBar(event.relatedTarget) || inPopup(event.relatedTarget)) return;
    focusBefore.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
  };
  const opened = (label: string, isOpen: boolean, { event }: { event: Event }) => {
    if (!isOpen) {
      openMenus.current.delete(label);
      return;
    }
    openMenus.current.add(label);
    openedByPointer.current.set(label, byPointer(event));
  };
  /**
   * Runs `id` once focus has left the menu's popup, if it landed where the menu was to put it (`expected`; null when
   * there is nothing to restore, the trigger then). A command run while the popup still holds focus would act on the
   * menu, and the menu moves focus after its close handlers, so this waits for the focus event itself. Focus that went
   * elsewhere, or none coming within the timeout, means the command would act on the wrong element: it is dropped.
   */
  const runWhenFocusBack = (id: string, expected: Element | null) => {
    const finish = (dropped?: string) => {
      document.removeEventListener("focusin", onFocusIn);
      clearTimeout(timer);
      if (dropped === undefined) runLogged(id);
      else console.error(`The command "${id}" didn't run: ${dropped}.`);
    };
    const onFocusIn = () => {
      if (inPopup(document.activeElement)) return;
      if (expected === null || document.activeElement === expected) finish();
      else finish("focus went to another element than the one the menu gave it back to");
    };
    const timer = setTimeout(() => finish("focus didn't leave the menu"), 1000);
    document.addEventListener("focusin", onFocusIn);
  };
  const finalFocusFor = (label: string) => (): HTMLElement | boolean => {
    const byPointer = openedByPointer.current.get(label) === true;
    const id = chosen.current;
    chosen.current = undefined;
    if (id === undefined && [...openMenus.current].some((open) => open !== label)) return false;
    const before = focusBefore.current?.isConnected === true ? focusBefore.current : null;
    const target = (byPointer || id !== undefined) && before !== null ? before : null;
    if (id !== undefined) runWhenFocusBack(id, target);
    return target ?? true;
  };
  return (
    <header className="grid h-titlebar shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-surface-0 [app-region:drag]">
      <Menubar ref={menubar} onFocusCapture={rememberFocus} className="gap-0.5 justify-self-start pl-2 [app-region:no-drag]">
        {MENUS.map((menu) => (
          <MenubarMenu key={menu.label} onOpenChange={(isOpen, details) => opened(menu.label, isOpen, details)}>
            <MenubarTrigger>{menu.label}</MenubarTrigger>
            <MenubarContent finalFocus={finalFocusFor(menu.label)} className="[app-region:no-drag]">
              <MenuEntries menu={menu} choose={(id) => (chosen.current = id)} />
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
      <div className="flex min-w-0 items-center gap-2 px-4">
        <WombatSymbol className="size-5 shrink-0" />
        <span className="text-sm font-semibold text-fg-primary">Wombat</span>
        {workspace === undefined ? null : (
          <>
            <span className="text-sm text-fg-tertiary">/</span>
            <span className="truncate text-sm text-fg-secondary">{workspace}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <LeftSidebarToggle toggle={leftToggle} />
        {/* The window controls sit over the bar's right end; this keeps the toggle clear of them. */}
        <div aria-hidden className="h-full w-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw))] shrink-0" />
      </div>
    </header>
  );
};
