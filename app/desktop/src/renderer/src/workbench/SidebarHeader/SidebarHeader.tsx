import type { ReactNode } from "react";

/** A sidebar's title row, with an optional count and actions at its end. */
export const SidebarHeader = ({ title, titleId, count, children }: { title: string; titleId?: string; count?: number; children?: ReactNode }) => (
  <header className="flex h-tab-strip shrink-0 items-center gap-2 border-b border-line px-3">
    <h2 id={titleId} className="text-sm font-semibold text-fg-primary">
      {title}
    </h2>
    {count === undefined ? null : <span className="text-sm text-fg-tertiary tabular-nums">{count}</span>}
    <div className="ml-auto flex items-center gap-1">{children}</div>
  </header>
);
