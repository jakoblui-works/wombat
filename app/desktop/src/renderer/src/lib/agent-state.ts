import type { AgentSummary } from "@wombat/shared/api";
import { CircleCheck, CircleStop, Hand, LoaderCircle, type LucideIcon, TriangleAlert } from "lucide-react";

export type AgentState = AgentSummary["state"];

export type AgentStateLook = {
  /** The state's name as a mark's label. */
  readonly label: string;
  /** The text-colour utility bound to the state's token (tokens.css), for its icon. */
  readonly colour: string;
  /** Its own shape, so states are told apart by more than colour. */
  readonly icon: LucideIcon;
  /** Whether its mark spins (the agent is busy). */
  readonly spins: boolean;
  /** Its place in the overview's order inside a workspace: what needs me first. */
  readonly rank: number;
};

/** How each agent state looks wherever it shows: the overview, Needs me and the workbench's marks. */
export const AGENT_STATES: Readonly<Record<AgentState, AgentStateLook>> = {
  waiting: { label: "Waiting on me", colour: "text-state-waiting", icon: Hand, spins: false, rank: 0 },
  working: { label: "Working", colour: "text-state-working", icon: LoaderCircle, spins: true, rank: 1 },
  error: { label: "Error", colour: "text-state-error", icon: TriangleAlert, spins: false, rank: 2 },
  done: { label: "Done", colour: "text-state-done", icon: CircleCheck, spins: false, rank: 3 },
  stopped: { label: "Stopped", colour: "text-state-stopped", icon: CircleStop, spins: false, rank: 4 },
};

/** Every state, by rank: the overview's order inside a workspace. */
export const STATE_ORDER: readonly AgentState[] = (Object.keys(AGENT_STATES) as AgentState[]).sort((a, b) => AGENT_STATES[a].rank - AGENT_STATES[b].rank);
