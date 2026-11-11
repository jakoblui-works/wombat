import type { AgentSummary } from "@wombat/shared/api";
import { z } from "zod";

import type { KnownContext, ResolveContext } from "../../registry.ts";

export const ChatParams = z.object({ agentId: z.string() });

/** How much of an agent id a title shows when there's nothing better. */
const SHORT_ID_LENGTH = 8;

/** A chat tab applies while its agent exists. */
export const chatResolves = (params: unknown, { agents }: KnownContext): boolean => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success && agents.some((agent) => agent.id === parsed.data.agentId);
};

/** The agent's title, else its repo, else (not listed, or the list is loading) the start of its id. One rule for the chat tab, the agent list and Needs me. */
export const agentTitle = (agentId: string, agent: Pick<AgentSummary, "title" | "repo"> | undefined): string =>
  agent?.title ?? agent?.repo ?? agentId.slice(0, SHORT_ID_LENGTH);

/** The chat tab's title: the agent's. */
export const chatTitle = (params: unknown, { agents }: ResolveContext): string => {
  const parsed = ChatParams.safeParse(params);
  if (!parsed.success) return "Chat";
  const { agentId } = parsed.data;
  return agentTitle(agentId, agents?.find(({ id }) => id === agentId));
};
