import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ActivityDescriptor } from "../registry.ts";

/**
 * The activities, then whatever sits at the foot (the connection indicator). While `blocked` the activities are dimmed
 * and inert; the foot stays live.
 */
export const ActivityBar = ({
  activities,
  active,
  blocked,
  onSelect,
  children,
}: {
  activities: readonly ActivityDescriptor[];
  active: string | undefined;
  blocked: boolean;
  onSelect: (id: string) => void;
  children: ReactNode;
}) => (
  <nav aria-label="Activities" className="flex w-activity-bar shrink-0 flex-col items-center border-r border-line bg-surface-0 py-2">
    <div inert={blocked} className={cn("flex flex-col items-center gap-1 transition-opacity", blocked && "dimmed")}>
      {activities.map(({ id, title, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={title}
          aria-label={title}
          aria-pressed={id === active}
          onClick={() => onSelect(id)}
          className={cn(
            "focus-ring relative flex size-9 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg-secondary",
            id === active && "bg-surface-2 text-fg-primary hover:text-fg-primary",
          )}
        >
          {id === active ? <span className="absolute inset-y-2 -left-1.5 w-0.5 rounded-full bg-fg-primary" /> : null}
          <Icon className="size-4.5" strokeWidth={1.75} />
        </button>
      ))}
    </div>
    <div className="mt-auto">{children}</div>
  </nav>
);
