import type { AgentSummary } from "@wombat/shared/api";

import { setOverviewCollapsed, type ShellState } from "../shell/shell-state.ts";

export const isCollapsed = (state: ShellState, workspace: string): boolean => state.workspaces[workspace]?.overviewCollapsed === true;

/** The same state when the group already is as asked. */
export const collapseGroup = (state: ShellState, workspace: string, collapsed: boolean): ShellState =>
  isCollapsed(state, workspace) === collapsed ? state : setOverviewCollapsed(state, workspace, collapsed);

/** Expands the overview's group holding the shown agent; the same state while the agent isn't among `agents`. */
export const expandShownAgent = (state: ShellState, agentId: string | undefined, agents: readonly Pick<AgentSummary, "id" | "workspace">[] | undefined): ShellState => {
  const workspace = agents?.find(({ id }) => id === agentId)?.workspace;
  return workspace === undefined ? state : collapseGroup(state, workspace, false);
};
