import { z } from "zod";

import type { ResolveContext } from "../../registry.ts";

export const ChatParams = z.object({ agentId: z.string() });

/** A chat tab applies while its agent exists (and is kept while the agents are loading). */
export const chatResolves = (params: unknown, { agents }: ResolveContext): boolean => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success && (agents === undefined || agents.some((agent) => agent.id === parsed.data.agentId));
};

export const chatTitle = (params: unknown): string => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success ? `Chat ${parsed.data.agentId}` : "Chat";
};
