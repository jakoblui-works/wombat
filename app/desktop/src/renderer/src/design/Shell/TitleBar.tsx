import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { WORKSPACE } from "../fixtures.ts";
import { WombatSymbol } from "../WombatSymbol/WombatSymbol.tsx";

/** The window's title area: the symbol and workspace on the left, the Needs me toggle on the right. */
export const TitleBar = ({ needsMe, needsMeOpen }: { needsMe: number; needsMeOpen: boolean }) => (
  <header className="flex h-titlebar shrink-0 items-center border-b border-line bg-surface-0 pr-2">
    <div className="flex w-activity-bar shrink-0 justify-center">
      <WombatSymbol className="size-5" />
    </div>
    <span className="text-sm font-semibold text-fg-primary">Wombat</span>
    <span className="mx-2 text-sm text-fg-tertiary">/</span>
    <span className="text-sm text-fg-secondary">{WORKSPACE}</span>
    <button
      type="button"
      aria-pressed={needsMeOpen}
      className={cn(
        "focus-ring ml-auto flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg-primary",
        needsMeOpen && "bg-surface-3 text-fg-primary",
      )}
    >
      <Inbox className="size-4" />
      Needs me
      <span className="rounded-sm bg-surface-3 px-1.5 text-xs font-medium text-state-waiting tabular-nums">{needsMe}</span>
    </button>
  </header>
);
