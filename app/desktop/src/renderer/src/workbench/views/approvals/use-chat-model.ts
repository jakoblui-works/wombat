import { useMemo } from "react";

import { chatModel } from "../../../data/chat-model.ts";
import { useAgentLog, useAgents } from "../../../data/hooks.ts";

/**
 * One agent's chat model, its summary and its log read: what the chat and the diff tab read, so both build the same
 * model (`chatModel` with the agent's main session) from the same log. `model` is undefined until the log is read.
 */
export const useChatModel = (agentId: string) => {
  const log = useAgentLog(agentId);
  const agents = useAgents();
  const agent = agents.data?.agents.find(({ id }) => id === agentId);
  const mainSessionId = agent?.sessionId;
  const entries = log.data?.entries;
  const model = useMemo(
    () => (entries === undefined ? undefined : chatModel(entries, mainSessionId === undefined ? {} : { mainSessionId })),
    [entries, mainSessionId],
  );
  return { model, agent, log };
};
