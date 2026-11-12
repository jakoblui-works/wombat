import { Circle, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { useNow } from "../../lib/ago";
import { CONNECTION_STATES } from "../../lib/connection-state";
import { cn } from "../../lib/utils";
import { startedClock, uptimeLabel } from "../../lib/uptime";
import type { ConnectionState } from "../../../../shared/bridge.ts";
import { runLogged } from "../commands/registry.ts";

type Tone = "ok" | "stale" | "pending" | "down";

/** What the service item says and how it looks for the connection `connection`; `agents` counts those with a process. */
const itemLook = (
  connection: ConnectionState,
  agents: number | undefined,
  now: number,
): { tone: Tone; text: string } => {
  switch (connection.state) {
    case "connecting":
    case "reconnecting":
      return { tone: "pending", text: "Service · connecting…" };
    case "failed":
    case "incompatible":
      return { tone: "down", text: "Service · not running" };
    case "connected": {
      const { service } = connection;
      const age =
        service?.startedAt === undefined
          ? "age unknown"
          : uptimeLabel(service.startedAt, now);
      if (service?.stale === true)
        return {
          tone: "stale",
          text: `Service · running ${age === "age unknown" ? "" : `${age} `}· older than the app`,
        };
      if (service?.startedAt === undefined)
        return { tone: "ok", text: "Service · running · age unknown" };
      // Never "no agents" unless the list was read.
      const count =
        agents === undefined
          ? ""
          : ` · ${agents === 0 ? "no agents" : `${String(agents)} ${agents === 1 ? "agent" : "agents"}`}`;
      return { tone: "ok", text: `Service · running ${age}${count}` };
    }
  }
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-fg-secondary",
  stale: "text-state-waiting",
  pending: "text-fg-tertiary",
  down: "text-danger",
};

const STATE_LINE: Record<ConnectionState["state"], string> = {
  connected: "Running",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  failed: "Not running: the app can't connect to it.",
  incompatible: "Running, but it doesn't match this app's version. Restart it.",
};

/**
 * The row along the bottom of the app. Its service item shows the agent service (so nobody has one in the background
 * unknowingly), and opens a panel with Stop and Restart. `agents` are the names of the agents with a process.
 */
export const StatusBar = ({
  connection,
  agents,
  now,
  onStop,
  onRestart,
}: {
  connection: ConnectionState;
  agents: readonly string[] | undefined;
  now: number;
  onStop: () => void;
  onRestart: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const { tone, text } = itemLook(connection, agents?.length, now);
  const stale =
    connection.state === "connected" && connection.service?.stale === true;
  const startedAt =
    connection.state === "connected"
      ? connection.service?.startedAt
      : undefined;
  return (
    <footer
      aria-label="Status"
      className="flex h-6 shrink-0 items-center border-t border-line bg-surface-0 text-sm"
    >
      {/* The group carries the state alone (the shell check reads it); the button's own name is its visible text. */}
      <div
        role="group"
        data-testid="connection-indicator"
        aria-label={CONNECTION_STATES[connection.state].label}
        className="h-full"
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={cn(
              "focus-ring flex h-full items-center gap-1.5 px-3 transition-colors hover:bg-surface-2",
              TONE_CLASS[tone],
            )}
          >
            {tone === "stale" ? (
              <TriangleAlert
                aria-hidden
                className="size-3 fill-current"
                strokeWidth={0}
              />
            ) : tone === "down" ? null : (
              <Circle
                aria-hidden
                className={cn(
                  "size-2.5",
                  tone === "ok" && "fill-current",
                  tone === "pending" && "motion-pulse",
                )}
                strokeWidth={tone === "ok" ? 0 : 2.5}
              />
            )}
            <span>{text}</span>
          </PopoverTrigger>
          <PopoverContent className="flex flex-col gap-2">
            <p className="font-medium text-fg-primary">Agent service</p>
            <p className="text-fg-secondary">{STATE_LINE[connection.state]}</p>
            {startedAt !== undefined ? (
              <p className="text-fg-secondary">
                Started {startedClock(startedAt)} ({uptimeLabel(startedAt, now)}{" "}
                ago)
              </p>
            ) : connection.state === "connected" ? (
              <p className="text-fg-secondary">
                Started: unknown (this service doesn't report it)
              </p>
            ) : null}
            <div className="text-fg-secondary">
              {agents === undefined ? (
                "Couldn't read the agents yet."
              ) : agents.length === 0 ? (
                "No agents with a process."
              ) : (
                <>
                  Agents with a process:
                  <ul className="mt-1 list-disc pl-5">
                    {agents.map((name, index) => (
                      <li key={index}>{name}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {stale ? (
              <p className="text-state-waiting">
                This service runs older code than the app. Restart it to use
                what's new; agents with a process stop.
              </p>
            ) : null}
            <div className="mt-1 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onStop();
                }}
              >
                Stop service
              </Button>
              <Button
                variant={stale ? "default" : "secondary"}
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onRestart();
                }}
              >
                Restart
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </footer>
  );
};

/** The status bar on the live clock (the uptime moves once a minute), its buttons running the Stop and Restart commands. */
export const LiveStatusBar = ({
  connection,
  agents,
}: {
  connection: ConnectionState;
  agents: readonly string[] | undefined;
}) => (
  <StatusBar
    connection={connection}
    agents={agents}
    now={useNow()}
    onStop={() => runLogged("service.stop")}
    onRestart={() => runLogged("service.restart")}
  />
);
