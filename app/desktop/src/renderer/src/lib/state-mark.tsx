import { type AgentState, AGENT_STATES } from "./agent-state";
import { usePlay } from "./motion";
import { cn } from "./utils";

/**
 * An agent state's mark: its icon in its colour, named by its label. A new state's mark fades in (the wrapper: the
 * icon's own animation is Working's endless spin, which would never let a fade end).
 */
export const StateMark = ({ state, entering = false }: { state: AgentState; /** The mark is new because its row moved on a state change: it fades in as it mounts. */ entering?: boolean }) => {
  const look = AGENT_STATES[state];
  const fade = usePlay<HTMLSpanElement>("motion-fade", state, { onMount: entering });
  return (
    <span key={state} ref={fade} className="inline-flex shrink-0">
      <look.icon aria-label={look.label} className={cn("size-3.5", look.colour, look.spins && "motion-spin")} />
    </span>
  );
};
