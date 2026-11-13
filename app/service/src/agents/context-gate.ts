/** What a context request on a running agent does now. */
export type ContextGate = "join" | "unsupported" | "turn_busy" | "hidden_busy" | "run";

/**
 * A context request's next step: share the report already being made, refuse while the agent's latest command list
 * (`commands`, undefined before the first) lacks the harness's `command` (no `command`: no such check), refuse while a
 * turn or another hidden turn runs, else run one.
 */
export const contextGate = ({
  reporting,
  command,
  commands,
  turn,
  hidden,
}: {
  reporting: boolean;
  command: string | undefined;
  commands: readonly string[] | undefined;
  turn: boolean;
  hidden: boolean;
}): ContextGate => {
  if (reporting) return "join";
  if (command !== undefined && !(commands ?? []).includes(command)) return "unsupported";
  if (turn) return "turn_busy";
  if (hidden) return "hidden_busy";
  return "run";
};
