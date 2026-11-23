import { repoName, ROOT_REPO, type AgentSummary, type Workspace } from "@wombat/shared/api";

/** How much of an agent id a title shows when there's nothing better. */
const SHORT_ID_LENGTH = 8;

/**
 * The agent's title, else its repo (an agent at its workspace's root, repo ".", takes the workspace's name), else the
 * start of its id: also when the workspace isn't listed or the list is loading, so a title is never a bare ".". One rule
 * for the chat tab, the agent list, Needs me and the proposals.
 */
export const agentTitle = (
  agentId: string,
  agent: Pick<AgentSummary, "title" | "repo" | "workspace"> | undefined,
  workspaces: readonly Pick<Workspace, "id" | "name">[] | undefined,
): string => {
  if (agent?.title !== undefined) return agent.title;
  if (agent === undefined) return agentId.slice(0, SHORT_ID_LENGTH);
  if (agent.repo !== ROOT_REPO) return agent.repo;
  const workspace = workspaces?.find(({ id }) => id === agent.workspace);
  return workspace === undefined ? agentId.slice(0, SHORT_ID_LENGTH) : repoName(agent.repo, workspace);
};
