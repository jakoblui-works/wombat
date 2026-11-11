import { chatModel } from "../../../data/chat-model.ts";
import { useAgentLog, useAgents } from "../../../data/hooks.ts";
import { ChatParams } from "./chat-params.ts";

/** The agent's chat as plain text, until the chat view gets its look. */
const AgentChat = ({ agentId }: { agentId: string }) => {
  const log = useAgentLog(agentId);
  const agents = useAgents();
  if (log.error) return <p>Couldn't read this agent's log: {log.error.message}</p>;
  if (log.data === undefined) return <p>Loading…</p>;
  const mainSessionId = agents.data?.agents.find((agent) => agent.id === agentId)?.sessionId;
  const model = chatModel(log.data.entries, mainSessionId === undefined ? {} : { mainSessionId });
  return (
    <div className="h-full overflow-auto">
      {log.data.truncated && <p>Earlier history wasn't kept.</p>}
      <pre className="whitespace-pre-wrap">{JSON.stringify(model, null, 2)}</pre>
    </div>
  );
};

export const Chat = ({ params }: { params: unknown }) => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success ? <AgentChat agentId={parsed.data.agentId} /> : <p>This tab names no agent; close it.</p>;
};
