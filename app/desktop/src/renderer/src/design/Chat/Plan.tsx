import { ChevronDown, Circle, CircleCheck, CircleDot, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";
import { PLAN } from "../fixtures.ts";

const STEP_ICONS = { done: CircleCheck, active: CircleDot, pending: Circle } as const;
const STEP_LABELS = { done: "Done", active: "In progress", pending: "To do" } as const;

/** The agent's plan, pinned above the conversation: its steps in one column, the title beside them where there's room. */
export const Plan = () => {
  const done = PLAN.filter((step) => step.status === "done").length;
  return (
    <section aria-label="Plan" className="@container shrink-0 border-b border-line bg-surface-1">
      <div className="mx-auto flex max-w-chat items-start gap-2 px-5 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1 @xl:flex-row @xl:gap-6">
          <div className="flex h-4.5 shrink-0 items-center gap-2 text-sm text-fg-secondary @xl:w-28">
            <ListChecks className="size-3.5" />
            <span className="font-medium">Plan</span>
            <span className="text-fg-tertiary tabular-nums">
              {done} of {PLAN.length}
            </span>
          </div>
          <ol className="flex min-w-0 flex-1 flex-col">
            {PLAN.map((step) => {
              const Icon = STEP_ICONS[step.status];
              return (
                <li key={step.text} className="flex min-w-0 items-center gap-2 text-sm leading-4.5">
                  <Icon
                    aria-label={STEP_LABELS[step.status]}
                    className={cn("size-3.5 shrink-0 text-fg-tertiary", step.status === "active" && "text-fg-primary")}
                  />
                  <span
                    className={cn(
                      "truncate text-fg-secondary",
                      step.status === "done" && "text-fg-tertiary line-through",
                      step.status === "active" && "font-medium text-fg-primary",
                    )}
                  >
                    {step.text}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <ChevronDown aria-label="Collapse the plan" className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" />
      </div>
    </section>
  );
};
