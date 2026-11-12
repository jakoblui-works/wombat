import { Circle, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { useNow } from "../../lib/ago";
import type { AgentSummary } from "@wombat/shared/api";
import { CONNECTION_STATES } from "../../lib/connection-state";
import { serviceView, type ServiceTone } from "../../lib/service-view";
import { cn } from "../../lib/utils";
import type { ConnectionState } from "../../../../shared/bridge.ts";
import { runLogged } from "../commands/registry.ts";

const TONE_CLASS: Record<ServiceTone, string> = {
  ok: "text-fg-secondary",
  warn: "text-state-waiting",
  pending: "text-fg-tertiary",
  down: "text-danger",
};

/**
 * The row along the bottom of the app. Its service item shows the agent service (so nobody has one in the background
 * unknowingly), and opens a panel with Stop and Restart. What they say is serviceView's; `agents` is the agents list,
 * undefined until read.
 */
export const StatusBar = ({
  connection,
  agents,
  now,
  onStop,
  onRestart,
}: {
  connection: ConnectionState;
  agents: readonly AgentSummary[] | undefined;
  now: number;
  onStop: () => void;
  onRestart: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const { item, announcement, panel } = serviceView({ connection, agents, now });
  const { tone, text } = item;
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
            {tone === "warn" ? (
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
            {panel.lines.map((line) => (
              <p key={line} className="text-fg-secondary">
                {line}
              </p>
            ))}
            {panel.agents !== undefined && panel.agents.length > 0 ? (
              <ul className="list-disc pl-5 text-fg-secondary">
                {panel.agents.map((agent) => (
                  <li key={agent.id}>{agent.title ?? agent.repo}</li>
                ))}
              </ul>
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
                variant={tone === "warn" ? "default" : "secondary"}
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
      {/* Announces each change of the item (not its uptime), which a screen reader wouldn't notice on the button. */}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </footer>
  );
};

/** The status bar on the live clock (the uptime moves once a minute), its buttons running the Stop and Restart commands. */
export const LiveStatusBar = ({
  connection,
  agents,
}: {
  connection: ConnectionState;
  agents: readonly AgentSummary[] | undefined;
}) => (
  <StatusBar
    connection={connection}
    agents={agents}
    now={useNow()}
    onStop={() => runLogged("service.stop")}
    onRestart={() => runLogged("service.restart")}
  />
);
