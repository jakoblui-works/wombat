import { X } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useNow } from "../../lib/ago";
import { serviceView } from "../../lib/service-view";
import type { ConnectionState } from "../../../../shared/bridge.ts";

/** A strip under the title bar, when the app connected to a service this launch found already running (serviceView's notice). */
export const LaunchNotice = ({
  text,
  restart,
  onRestart,
  onDismiss,
}: {
  text: string;
  restart: boolean;
  onRestart: () => void;
  onDismiss: () => void;
}) => (
  <div role="region" aria-label="Agent service notice" data-testid="launch-notice" className="flex min-h-10 shrink-0 items-center gap-3 border-b border-line bg-surface-2 py-1 pr-2 pl-4">
    <span className="min-w-0 text-base text-fg-primary">{text}</span>
    {restart ? (
      <Button variant="default" size="sm" className="ml-auto shrink-0" onClick={onRestart}>
        Restart
      </Button>
    ) : null}
    <Button variant="ghost" size="icon-sm" className={restart ? "" : "ml-auto"} aria-label="Dismiss" onClick={onDismiss}>
      <X />
    </Button>
  </div>
);

/** The notice on the live clock, or nothing when serviceView has none: it ticks itself, so the workbench doesn't re-render each minute. */
export const LiveLaunchNotice = ({ connection, ...actions }: { connection: ConnectionState; onRestart: () => void; onDismiss: () => void }) => {
  const { notice } = serviceView({ connection, agents: undefined, now: useNow() });
  return notice === undefined ? null : <LaunchNotice {...notice} {...actions} />;
};
