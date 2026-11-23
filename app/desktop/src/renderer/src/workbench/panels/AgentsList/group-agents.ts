import type { AgentSummary, Workspace } from "@wombat/shared/api";

import { STATE_ORDER } from "../../../lib/agent-state";

export type AgentGroup = { workspace: Workspace; agents: AgentSummary[] };

const byStateThenNewest = (a: AgentSummary, b: AgentSummary): number =>
  STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id);

/**
 * The overview's groups: one per listed workspace in the list's order (one without agents too), each by state, then
 * newest activity first. An agent whose workspace isn't listed is in no group.
 */
export const groupAgents = (agents: readonly AgentSummary[], workspaces: readonly Workspace[]): AgentGroup[] =>
  workspaces.map((workspace) => ({ workspace, agents: agents.filter((agent) => agent.workspace === workspace.id).sort(byStateThenNewest) }));
