import type { AgentSummary } from "@wombat/shared/api";

/** How much of an agent id a title shows when there's nothing better. */
const SHORT_ID_LENGTH = 8;

/** The agent's title, else its repo, else (not listed, or the list is loading) the start of its id. One rule for the chat tab, the agent list and Needs me. */
export const agentTitle = (agentId: string, agent: Pick<AgentSummary, "title" | "repo"> | undefined): string =>
  agent?.title ?? agent?.repo ?? agentId.slice(0, SHORT_ID_LENGTH);
