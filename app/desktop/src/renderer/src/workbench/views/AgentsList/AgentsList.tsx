import { useAgents } from "../../../data/hooks.ts";
import { useWorkbench } from "../../workbench-context.ts";

/** The agents, each opening its chat. */
export const AgentsList = () => {
  const agents = useAgents();
  const { openTab } = useWorkbench();
  if (agents.error) return <p>Couldn't read the agents: {agents.error.message}</p>;
  if (agents.data === undefined) return <p>Loading…</p>;
  if (agents.data.agents.length === 0) return <p>No agents yet.</p>;
  return (
    <ul>
      {agents.data.agents.map((agent) => (
        <li key={agent.id}>
          <button type="button" onClick={() => openTab("chat", { agentId: agent.id })}>
            {agent.title ?? agent.id} ({agent.state})
          </button>
        </li>
      ))}
    </ul>
  );
};
