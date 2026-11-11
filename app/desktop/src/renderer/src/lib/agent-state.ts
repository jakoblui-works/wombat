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
};

/** How each agent state looks wherever it shows: the agent list, Needs me and the workbench's marks. */
export const AGENT_STATES: Readonly<Record<AgentState, AgentStateLook>> = {
  waiting: { label: "Waiting on me", colour: "text-state-waiting", icon: Hand },
  working: { label: "Working", colour: "text-state-working", icon: LoaderCircle },
  done: { label: "Done", colour: "text-state-done", icon: CircleCheck },
  error: { label: "Error", colour: "text-state-error", icon: TriangleAlert },
  stopped: { label: "Stopped", colour: "text-state-stopped", icon: CircleStop },
};

/** The order of the agent list's groups: what needs me first. */
export const AGENT_STATE_ORDER: readonly AgentState[] = ["waiting", "working", "done", "error", "stopped"];
