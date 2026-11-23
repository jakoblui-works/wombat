import type { AgentSummary } from "@wombat/shared/api";

import { AGENTS_PANEL } from "../activity-ids.ts";
import { activityStatesOf, changeActivityState, type ShellState } from "../shell/shell-state.ts";

type OverviewState = { collapsed?: boolean };

const overviewState = (state: ShellState, workspace: string): OverviewState => {
  const own = activityStatesOf(state, workspace)[AGENTS_PANEL];
  return typeof own === "object" && own !== null && "collapsed" in own && typeof own.collapsed === "boolean" ? { collapsed: own.collapsed } : {};
};

export const isCollapsed = (state: ShellState, workspace: string): boolean => overviewState(state, workspace).collapsed === true;

/** The same state when the group already is as asked. */
export const collapseGroup = (state: ShellState, workspace: string, collapsed: boolean): ShellState =>
  isCollapsed(state, workspace) === collapsed
    ? state
    : changeActivityState(state, workspace, AGENTS_PANEL, () => ({ ...overviewState(state, workspace), collapsed }));

/** Expands the overview's group holding the shown agent; the same state while the agent isn't among `agents`. */
export const expandShownAgent = (state: ShellState, agentId: string | undefined, agents: readonly Pick<AgentSummary, "id" | "workspace">[] | undefined): ShellState => {
  const workspace = agents?.find(({ id }) => id === agentId)?.workspace;
  return workspace === undefined ? state : collapseGroup(state, workspace, false);
};
