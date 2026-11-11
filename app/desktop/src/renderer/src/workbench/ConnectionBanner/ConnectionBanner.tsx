import { LoaderCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { bannerTitle, CONNECTION_STATES, type Connection, type RestartAttempt } from "@/lib/connection-state";

/** A strip under the title bar while the connection to the service is lost: what happened, and Restart. */
export const ConnectionBanner = ({
  connection,
  message,
  attempt,
  onRestart,
}: {
  connection: Connection;
  message: string | undefined;
  attempt: RestartAttempt;
  onRestart: () => void;
}) => {
  const { detail, pulses } = CONNECTION_STATES[connection];
  return (
    <div role="alert" className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-surface-2 pr-2 pl-4">
      {pulses ? <LoaderCircle aria-hidden className="size-4 shrink-0 motion-spin text-fg-secondary" /> : null}
      <span className="text-base font-medium text-fg-primary">{bannerTitle(connection)}</span>
      <span className="min-w-0 truncate text-sm text-fg-secondary">{attempt.error ?? message ?? detail}</span>
      <Button variant="secondary" size="sm" className="ml-auto" disabled={attempt.pending} onClick={onRestart}>
        <RotateCw />
        Restart
      </Button>
    </div>
  );
};
