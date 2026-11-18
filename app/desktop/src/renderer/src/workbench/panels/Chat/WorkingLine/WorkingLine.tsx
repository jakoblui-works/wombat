import type { Activity } from "@wombat/shared/api";

import { activityLabel } from "../../../../lib/activity.ts";
import { usePlay } from "../../../../lib/motion.ts";

/** What the agent is doing right now, above the message box: a pulsing dot and the words. Nothing without an activity. */
export const WorkingLine = ({ activity }: { activity: Activity | null }) => {
  const label = activity === null ? null : activityLabel(activity);
  const fade = usePlay<HTMLSpanElement>("motion-fade", label);
  if (label === null) return null;
  return (
    <div role="status" className="mx-auto flex w-full max-w-chat items-center gap-2 px-5 pb-2 text-sm text-fg-secondary">
      <span aria-hidden="true" className="size-2 shrink-0 motion-pulse rounded-full bg-state-working" />
      <span key={label} ref={fade} className="min-w-0 truncate">
        {label}
      </span>
    </div>
  );
};
