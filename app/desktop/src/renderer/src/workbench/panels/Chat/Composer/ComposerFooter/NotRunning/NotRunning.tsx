import type { ChatAccess } from "@wombat/shared/api";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../../components/ui/tooltip";

/** What the indicator's tooltip says: whether the agent's next message starts it again. */
export const notRunningHint = (access: Exclude<ChatAccess, "running">): string =>
  access === "resumable" ? "Your next message starts it again" : "Start a new agent to continue";

/**
 * In place of the `context` slot while the agent has no process (ComposerFooter): a hollow grey dot and "Not
 * running", the tooltip saying what happens next. The same tooltip and delay as the ContextRing.
 */
export const NotRunning = ({ access }: { access: Exclude<ChatAccess, "running"> }) => (
  <Tooltip>
    <TooltipTrigger
      delay={200}
      render={<span tabIndex={0} className="focus-ring -my-1 ml-auto inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-xs text-fg-tertiary" />}
    >
      <span aria-hidden="true" className="size-2 rounded-full border border-fg-tertiary" />
      <span>Not running</span>
    </TooltipTrigger>
    <TooltipContent>{notRunningHint(access)}</TooltipContent>
  </Tooltip>
);
