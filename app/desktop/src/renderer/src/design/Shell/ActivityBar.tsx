import { Bot, Files, FolderCog, GitBranch, LayoutDashboard, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type DesignActivity = "agents" | "files" | "source-control" | "workspace" | "project-overview";

const ACTIVITIES: readonly { id: DesignActivity; title: string; icon: LucideIcon }[] = [
  { id: "agents", title: "Agents", icon: Bot },
  { id: "files", title: "Files", icon: Files },
  { id: "source-control", title: "Source control", icon: GitBranch },
  { id: "workspace", title: "Workspace", icon: FolderCog },
  { id: "project-overview", title: "Project overview", icon: LayoutDashboard },
];

export type Connection = "connected" | "reconnecting";

/** Connected: a filled dot. Reconnecting: an open ring, pulsing (still under reduced motion: the ring alone tells). */
const ConnectionDot = ({ connection }: { connection: Connection }) => (
  <div
    role="status"
    title={connection === "connected" ? "Connected to the service" : "Reconnecting to the service"}
    className="flex size-9 items-center justify-center"
  >
    <span className="sr-only">{connection === "connected" ? "Connected" : "Reconnecting"}</span>
    {connection === "connected" ? (
      <span className="size-2 rounded-full bg-connection-ok" />
    ) : (
      <span className="size-2.5 animate-pulse rounded-full border-2 border-connection-lost" />
    )}
  </div>
);

/** The activities, then the connection dot. While blocked, the activities are dimmed and inert; the dot still shows. */
export const ActivityBar = ({ active, connection, blocked }: { active: DesignActivity; connection: Connection; blocked: boolean }) => (
  <nav aria-label="Activities" className="flex w-activity-bar shrink-0 flex-col items-center border-r border-line bg-surface-0 py-2">
    <div inert={blocked} className={cn("flex flex-col items-center gap-1", blocked && "opacity-40")}>
      {ACTIVITIES.map(({ id, title, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={title}
          aria-label={title}
          aria-current={id === active ? "page" : undefined}
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
    <div className="mt-auto">
      <ConnectionDot connection={connection} />
    </div>
  </nav>
);
