// What a running agent's composer bar shows, and its collapse, pure.
import type { AgentSummary, ListHarnessesResponse, Workspace } from "@wombat/shared/api";

import type { ShellState } from "../../../shell/shell-state.ts";

/** A repo path's name: the workspace root (`"."`) is named after its workspace. */
export const repoName = (path: string, workspace: Pick<Workspace, "name">): string => (path === "." ? workspace.name : path);

/** The harness's listed name, else its id (unlisted, or the list is still loading). */
export const harnessName = (harnesses: ListHarnessesResponse | undefined, id: string): string => harnesses?.find((listed) => listed.id === id)?.name ?? id;

export type RunningBarValues = { workspace: string | undefined; repo: string | undefined; harness: string; branch: string | undefined };

/** The workspace and repo stay unnamed while the agent's workspace isn't listed. */
export const runningBarValues = (
  agent: Pick<AgentSummary, "workspace" | "repo" | "harness" | "branch">,
  workspaces: readonly Workspace[] | undefined,
  harnesses: ListHarnessesResponse | undefined,
): RunningBarValues => {
  const workspace = workspaces?.find(({ id }) => id === agent.workspace);
  return {
    workspace: workspace?.name,
    repo: workspace === undefined ? undefined : repoName(agent.repo, workspace),
    harness: harnessName(harnesses, agent.harness),
    branch: agent.branch,
  };
};

export const collapseBar = (state: ShellState, collapsed: boolean): ShellState => ({ ...state, barCollapsed: collapsed });
