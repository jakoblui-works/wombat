import { z } from "zod";

import { agentTitle } from "../../lib/agent-title.ts";
import type { KnownContext, ResolveContext } from "../registry.ts";

export const ChatParams = z.object({ agentId: z.string() });

/** The chat panel's id: its registration and every tab opened on it. */
export const CHAT_PANEL = "chat";

/** The empty chat's panel id: the middle shows it while no agent is open. */
export const NEW_CHAT_PANEL = "new-chat";

const MESSAGE_BOX_ATTRIBUTE = "data-message-box";

/** Marks the chat's message box, for `MESSAGE_BOX` to find. */
export const messageBoxMark = { [MESSAGE_BOX_ATTRIBUTE]: "" };

export const MESSAGE_BOX = `[${MESSAGE_BOX_ATTRIBUTE}]`;

/** A chat tab applies while its agent exists. */
export const chatResolves = (params: unknown, { agents }: KnownContext): boolean => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success && agents.some((agent) => agent.id === parsed.data.agentId);
};

/** The chat tab's title: the agent's. */
export const chatTitle = (params: unknown, { agents }: ResolveContext): string => {
  const parsed = ChatParams.safeParse(params);
  if (!parsed.success) return "Chat";
  const { agentId } = parsed.data;
  return agentTitle(agentId, agents?.find(({ id }) => id === agentId));
};
