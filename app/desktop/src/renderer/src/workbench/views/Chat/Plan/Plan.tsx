import { ChevronDown, ChevronUp, Circle, CircleCheck, CircleDot, ListChecks } from "lucide-react";
import { useState } from "react";

import { Collapse } from "../../../../components/ui/collapse";
import type { PlanEntry } from "../../../../data/chat-model.ts";
import { cn } from "../../../../lib/utils";

const STEP_LOOK = {
  completed: { icon: CircleCheck, label: "Done" },
  in_progress: { icon: CircleDot, label: "In progress" },
  pending: { icon: Circle, label: "To do" },
} as const;

/**
 * The agent's plan, pinned above the conversation: its steps in one column, the title beside them where there's room.
 * Collapsed, only the title and the step in progress show. (The toggle is named for what it does rather than marked
 * `aria-expanded`: the chat's collapsed parts are its messages' reasoning and tool calls.)
 */
export const Plan = ({ entries }: { entries: readonly PlanEntry[] }) => {
  const [collapsed, setCollapsed] = useState(false);
  const done = entries.filter((step) => step.status === "completed").length;
  // Collapsed, only the first step in progress stays; the others fold away.
  const kept = entries.findIndex((step) => step.status === "in_progress");
  const Toggle = collapsed ? ChevronUp : ChevronDown;
  return (
    <section aria-label="Plan" className="@container shrink-0 border-b border-line bg-surface-1">
      <div className="mx-auto flex max-w-chat items-start gap-2 px-5 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1 @xl:flex-row @xl:gap-6">
          <div className="flex h-4.5 shrink-0 items-center gap-2 text-sm text-fg-secondary @xl:w-28">
            <ListChecks className="size-3.5" />
            <span className="font-medium">Plan</span>
            <span className="text-fg-tertiary tabular-nums">
              {done} of {entries.length}
            </span>
          </div>
          <ol className="flex max-h-40 min-w-0 flex-1 flex-col overflow-y-auto">
            {entries.map((step, index) => {
              const look = STEP_LOOK[step.status];
              return (
                <Collapse key={index} render={<li />} open={!collapsed || index === kept} className="flex min-w-0 items-center gap-2 text-sm leading-4.5">
                  <look.icon aria-label={look.label} className={cn("size-3.5 shrink-0 text-fg-tertiary", step.status === "in_progress" && "text-fg-primary")} />
                  <span
                    className={cn(
                      "truncate text-fg-secondary",
                      step.status === "completed" && "text-fg-tertiary line-through",
                      step.status === "in_progress" && "font-medium text-fg-primary",
                    )}
                  >
                    {step.content}
                  </span>
                </Collapse>
              );
            })}
          </ol>
        </div>
        <button
          type="button"
          aria-label={collapsed ? "Show the whole plan" : "Collapse the plan"}
          onClick={() => setCollapsed(!collapsed)}
          className="focus-ring mt-0.5 rounded-xs text-fg-tertiary transition-colors hover:text-fg-secondary"
        >
          <Toggle className="size-3.5" />
        </button>
      </div>
    </section>
  );
};
