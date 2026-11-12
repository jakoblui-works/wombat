import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { WombatSymbol } from "../views/EmptyState/WombatSymbol.tsx";

/** The last folder of a path, either separator. */
const folderName = (root: string): string =>
  root.split(/[\\/]/).filter(Boolean).pop() ?? root;

/** The window's title area: the symbol and workspace on the left, the right sidebar's toggle (named after its view) on the right. */
export const TitleBar = ({
  right,
  count = 0,
  rightOpen,
  onToggleRight,
}: {
  right: { title: string; icon: LucideIcon } | undefined;
  /** What waits on the user: shown after the toggle's name while above 0. */
  count?: number;
  rightOpen: boolean;
  onToggleRight: () => void;
}) => {
  const [workspace, setWorkspace] = useState<string>();
  useEffect(() => {
    let live = true;
    window.wombat.workspace.get().then(
      ({ root }) => live && setWorkspace(folderName(root)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <header className="flex h-titlebar shrink-0 items-center border-b border-line bg-surface-0 pr-2">
      <div className="flex w-activity-bar shrink-0 justify-center">
        <WombatSymbol className="size-5" />
      </div>
      <span className="text-sm font-semibold text-fg-primary">Wombat</span>
      {workspace === undefined ? null : (
        <>
          <span className="mx-2 text-sm text-fg-tertiary">/</span>
          <span className="text-sm text-fg-secondary">{workspace}</span>
        </>
      )}
      {right === undefined ? null : (
        <button
          type="button"
          aria-pressed={rightOpen}
          onClick={onToggleRight}
          className={cn(
            "focus-ring ml-auto flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg-primary",
            rightOpen && "bg-surface-3 text-fg-primary",
          )}
        >
          <right.icon className="size-4" />
          {right.title}{" "}
          {count > 0 ? <span className="text-fg-tertiary tabular-nums">{count}</span> : null}
        </button>
      )}
    </header>
  );
};
