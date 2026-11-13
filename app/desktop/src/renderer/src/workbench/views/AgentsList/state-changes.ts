// Which agents changed state since the list was last drawn, pure: a row that moves to another group is drawn anew, so
// its mark can't tell by itself that its state is new; the list tells it.
import type { AgentState } from "../../../lib/agent-state";

export type StateChanges = {
  /** Each listed agent's state as of the last list. */
  known: ReadonlyMap<string, AgentState>;
  /** The agents whose state differs from the list before; none for the first list and for an agent new to it. */
  changed: ReadonlySet<string>;
};

export const NO_STATE_CHANGES: StateChanges = { known: new Map(), changed: new Set() };

/** The changes `agents` brings (the same object when no state differs from `before`, so it can sit in state and keep `changed` until the next update). */
export const trackStates = (before: StateChanges, agents: readonly { id: string; state: AgentState }[]): StateChanges => {
  const first = before.known.size === 0;
  const changed = agents.filter(({ id, state }) => !first && before.known.has(id) && before.known.get(id) !== state).map(({ id }) => id);
  const same = agents.length === before.known.size && agents.every(({ id, state }) => before.known.get(id) === state);
  return same ? before : { known: new Map(agents.map(({ id, state }) => [id, state])), changed: new Set(changed) };
};
