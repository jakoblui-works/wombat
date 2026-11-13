import type { AgentSummary } from "@wombat/shared/api";
import { CircleCheck, CircleStop, Hand, LoaderCircle, type LucideIcon, TriangleAlert } from "lucide-react";

export type AgentState = AgentSummary["state"];

export type AgentStateLook = {
  /** The state's name as a group heading or a mark's label. */
  readonly label: string;
  /** The text-colour utility bound to the state's token (tokens.css), for its icon. */
  readonly colour: string;
  /** Its own shape, so states are told apart by more than colour. */
  readonly icon: LucideIcon;
  /** Whether its mark spins (the agent is busy). */
  readonly spins: boolean;
  /** Its place in the agent list's groups: what needs me first. */
  readonly rank: number;
};

/** How each agent state looks wherever it shows: the agent list, Needs me and the workbench's marks. */
export const AGENT_STATES: Readonly<Record<AgentState, AgentStateLook>> = {
  waiting: { label: "Waiting on me", colour: "text-state-waiting", icon: Hand, spins: false, rank: 0 },
  working: { label: "Working", colour: "text-state-working", icon: LoaderCircle, spins: true, rank: 1 },
  done: { label: "Done", colour: "text-state-done", icon: CircleCheck, spins: false, rank: 2 },
  error: { label: "Error", colour: "text-state-error", icon: TriangleAlert, spins: false, rank: 3 },
  stopped: { label: "Stopped", colour: "text-state-stopped", icon: CircleStop, spins: false, rank: 4 },
};

/** The order of the agent list's groups: every state, by rank (a new state gets a group as soon as it's in the map). */
export const AGENT_STATE_ORDER: readonly AgentState[] = (Object.keys(AGENT_STATES) as AgentState[]).sort(
  (a, b) => AGENT_STATES[a].rank - AGENT_STATES[b].rank,
);

/** The group an agent shows in on the agent list: a stopped agent is finished, so it shows under Done. */
export const listGroup = (state: AgentState): AgentState => (state === "stopped" ? "done" : state);

/** The agent list's groups, in order: every state that is its own group. */
export const LIST_GROUP_ORDER: readonly AgentState[] = AGENT_STATE_ORDER.filter((state) => listGroup(state) === state);
