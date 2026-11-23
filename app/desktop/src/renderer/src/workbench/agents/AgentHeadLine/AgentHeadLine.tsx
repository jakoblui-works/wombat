import type { AgentState } from "../../../lib/agent-state";
import { StateMark } from "../../../lib/state-mark";

/** The indent that lines a row's further lines up under the head line's title, past the state mark. */
export const UNDER_TITLE = "pl-5.5";

/** An agent's row head, in the overview and Needs me: its state mark, its title and how long ago. */
export const AgentHeadLine = ({ state, title, ago }: { state: AgentState; title: string; ago: string }) => (
  <span className="flex w-full items-center gap-2">
    <StateMark state={state} />
    <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-primary">{title}</span>{" "}
    <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{ago}</span>
  </span>
);
