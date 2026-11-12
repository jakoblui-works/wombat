import { type AgentState, AGENT_STATES } from "./agent-state";
import { cn } from "./utils";

/** An agent state's mark: its icon in its colour, named by its label. */
export const StateMark = ({ state }: { state: AgentState }) => {
  const look = AGENT_STATES[state];
  return <look.icon aria-label={look.label} className={cn("size-3.5 shrink-0", look.colour)} />;
};
