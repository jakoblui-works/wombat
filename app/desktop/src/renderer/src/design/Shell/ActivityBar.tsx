import { CircleAlert, CircleX } from "lucide-react";

import type { ConnectionState } from "../../../../shared/bridge.ts";
import { cn } from "@/lib/utils";
import type { ActivityDescriptor } from "../../workbench/registry.ts";

export type Connection = ConnectionState["state"];

/**
 * The connection to the service, at the foot of the activity bar. Connected: a filled dot. Connecting or reconnecting:
 * an open ring, pulsing. Failed or incompatible: an icon of its own. Each tells by shape, not colour alone.
 */
const CONNECTION_LOOKS: Record<Connection, { label: string; mark: "dot" | "ring" | typeof CircleX }> = {
  connected: { label: "Connected to the service", mark: "dot" },
  connecting: { label: "Connecting to the service", mark: "ring" },
  reconnecting: { label: "Reconnecting to the service", mark: "ring" },
  failed: { label: "Can't connect to the service", mark: CircleX },
  incompatible: { label: "The service doesn't match this app's version", mark: CircleAlert },
};

const ConnectionDot = ({ connection }: { connection: Connection }) => {
  const { label, mark: Mark } = CONNECTION_LOOKS[connection];
  return (
    <div role="status" title={label} className="flex size-9 items-center justify-center">
      <span className="sr-only">{label}</span>
      {Mark === "dot" ? (
        <span className="size-2 rounded-full bg-connection-ok" />
      ) : Mark === "ring" ? (
        <span className="size-2.5 animate-pulse rounded-full border-2 border-connection-lost" />
      ) : (
        <Mark className="size-3.5 text-connection-lost" />
      )}
    </div>
  );
};

/** The activities, then the connection dot. While blocked, the activities are dimmed and inert; the dot still shows. */
export const ActivityBar = ({
  activities,
  active,
  connection,
  blocked,
}: {
  activities: readonly ActivityDescriptor[];
  active: string;
  connection: Connection;
  blocked: boolean;
}) => (
  <nav aria-label="Activities" className="flex w-activity-bar shrink-0 flex-col items-center border-r border-line bg-surface-0 py-2">
    <div inert={blocked} className={cn("flex flex-col items-center gap-1", blocked && "opacity-40")}>
      {activities.map(({ id, title, icon: Icon }) => (
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
