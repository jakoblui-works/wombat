import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../../components/ui/context-menu.tsx";
import { closeGuards, tabKey } from "../../tabs.ts";
import { activateTab, closeOtherTabs, keepTab, type TabEntry } from "../shell-state.ts";
import { useShell } from "../ShellProvider.tsx";
import { requestClose } from "./tab-actions.ts";
import { tabElementIds } from "./tab-ids.ts";
import { tabTitle, type TabTitles } from "./tab-titles.ts";

/** The index `key` moves to from tab `at` of `count`; undefined for a key that doesn't move. */
const movedTo = (key: string, at: number, count: number): number | undefined => {
  if (key === "ArrowRight") return (at + 1) % count;
  if (key === "ArrowLeft") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
};

type StripTabProps = {
  tab: TabEntry;
  ids: { tab: string; panel: string };
  active: boolean;
  shown: boolean;
  titles: TabTitles;
  onActivate: () => void;
  onKeep: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
};

const StripTab = ({ tab, ids, active, shown, titles, onActivate, onKeep, onClose, onCloseOthers, onKey }: StripTabProps) => {
  const key = tabKey(tab.panelId, tab.params);
  const held = useSyncExternalStore(titles.subscribe, () => titles.get(key));
  const title = tabTitle(tab, held);
  const element = useRef<HTMLDivElement>(null);
  // Scrolling does nothing while the strip is hidden, and a longer title can push the close button past the edge.
  useEffect(() => {
    if (active && shown) element.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, shown, title]);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={element}
        role="presentation"
        className={cn(
          "group flex h-full max-w-56 shrink-0 cursor-default items-center border-r border-line-subtle pr-1 text-sm select-none",
          active ? "bg-surface-1 text-fg-primary" : "text-fg-tertiary hover:text-fg-secondary",
        )}
      >
        <div
          role="tab"
          id={ids.tab}
          aria-controls={ids.panel}
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          title={title}
          data-tab-key={key}
          className="focus-ring flex h-full min-w-0 items-center pr-1 pl-3 outline-none"
          onClick={onActivate}
          onDoubleClick={onKeep}
          onKeyDown={onKey}
        >
          <span className={cn("truncate", !tab.kept && "italic")}>{title}</span>
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          tabIndex={-1}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary",
            active ? "visible" : "invisible group-hover:visible group-focus-within:visible",
          )}
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClose}>Close</ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>Close others</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={tab.kept} onClick={onKeep}>
          Keep
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

/** Workspace `workspace`'s tab strip. A close asks the tab's close guard first; Close others leaves tabs with unsaved edits open. */
export const TabStrip = ({ workspace, strip, shown, titles }: { workspace: string; strip: string; shown: boolean; titles: TabTitles }) => {
  const { state, change } = useShell();
  const shell = state.workspaces[workspace];
  const tabs = shell?.tabs ?? [];
  const guards = closeGuards();
  const onKey = (at: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const to = movedTo(event.key, at, tabs.length);
    const target = to === undefined ? undefined : tabs[to];
    if (target === undefined) return;
    event.preventDefault();
    const key = tabKey(target.panelId, target.params);
    change((current) => activateTab(current, workspace, key));
    event.currentTarget.closest('[role="tablist"]')?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(key)}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      onWheel={(event) => {
        event.currentTarget.scrollLeft += event.deltaY;
      }}
    >
      {tabs.map((tab, at) => {
        const key = tabKey(tab.panelId, tab.params);
        return (
          <StripTab
            key={key}
            tab={tab}
            ids={tabElementIds(strip, at)}
            active={shell?.active === key}
            shown={shown}
            titles={titles}
            onActivate={() => change((current) => activateTab(current, workspace, key))}
            onKeep={() => change((current) => keepTab(current, workspace, key))}
            onClose={() => requestClose(change, workspace, key)}
            onCloseOthers={() => change((current) => closeOtherTabs(current, workspace, key, guards.unsaved))}
            onKey={onKey(at)}
          />
        );
      })}
    </div>
  );
};
