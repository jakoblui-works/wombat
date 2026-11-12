import { X } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useNow } from "../../lib/ago";
import { startedClock, uptimeLabel } from "../../lib/uptime";

/** A strip under the title bar, once per launch, when the app connected to a service that was already running. */
/** The notice on the live clock: it ticks itself, so the workbench doesn't re-render each minute. */
export const LiveLaunchNotice = (props: Omit<Parameters<typeof LaunchNotice>[0], "now">) => <LaunchNotice {...props} now={useNow()} />;

export const LaunchNotice = ({
  startedAt,
  stale,
  now,
  onRestart,
  onDismiss,
}: {
  startedAt: string;
  stale: boolean;
  now: number;
  onRestart: () => void;
  onDismiss: () => void;
}) => (
  <div role="region" aria-label="Agent service notice" data-testid="launch-notice" className="flex min-h-10 shrink-0 items-center gap-3 border-b border-line bg-surface-2 py-1 pr-2 pl-4">
    <span className="min-w-0 text-base text-fg-primary">
      Connected to the agent service that has been running since {startedClock(startedAt)} ({uptimeLabel(startedAt, now)}).
      {stale ? " It runs older code than the app." : ""}
    </span>
    {stale ? (
      <Button variant="default" size="sm" className="ml-auto shrink-0" onClick={onRestart}>
        Restart
      </Button>
    ) : null}
    <Button variant="ghost" size="icon-sm" className={stale ? "" : "ml-auto"} aria-label="Dismiss" onClick={onDismiss}>
      <X />
    </Button>
  </div>
);
