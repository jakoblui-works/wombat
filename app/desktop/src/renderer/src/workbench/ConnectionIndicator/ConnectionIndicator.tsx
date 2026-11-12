import { CONNECTION_STATES, type Connection } from "@/lib/connection-state";
import { cn } from "@/lib/utils";

/** The connection to the service: a shape and a colour per state, labelled for screen readers. */
export const ConnectionIndicator = ({ connection }: { connection: Connection }) => {
  const { label, colour, icon: Icon, filled, pulses } = CONNECTION_STATES[connection];
  return (
    <div role="status" data-testid="connection-indicator" aria-label={label} title={label} className="flex size-9 items-center justify-center">
      <Icon aria-hidden className={cn("size-3", colour, filled && "fill-current", pulses && "motion-pulse")} strokeWidth={filled ? 0 : 2.5} />
      <span className="sr-only">{label}</span>
    </div>
  );
};
