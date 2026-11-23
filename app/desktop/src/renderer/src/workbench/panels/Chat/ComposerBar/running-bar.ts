// What a running agent's composer bar shows, pure.
import { repoName, type AgentSummary, type ListHarnessesResponse, type Workspace } from "@wombat/shared/api";

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
