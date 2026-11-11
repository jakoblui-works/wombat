import type { AgentSummary } from "@wombat/shared/api";
import { Square, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../../components/ui/button";
import { AGENT_STATES } from "../../../../lib/agent-state";
import { cn } from "../../../../lib/utils";
import { canStop, useAgentActions } from "../../AgentsList/agent-actions.ts";
import { agentTitle } from "../chat-params.ts";
import { useActionError } from "../DeleteAgentDialog/action-error.ts";
import { DeleteAgentDialog } from "../DeleteAgentDialog/DeleteAgentDialog.tsx";

type Props = { agentId: string; agent: AgentSummary | undefined; connected: boolean };

/** The chat's header: the agent's state and title, Stop while it runs, and Delete (confirmed first). */
export const ChatHeader = ({ agentId, agent, connected }: Props) => {
  const title = agentTitle(agentId, agent);
  const state = agent === undefined ? undefined : AGENT_STATES[agent.state];
  const actions = useAgentActions(agentId);
  const [confirming, setConfirming] = useState(false);
  const error = useActionError(actions.error, agent?.state, confirming);

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      {state === undefined ? null : <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />}
      <h2 className="min-w-0 truncate text-sm font-medium text-fg-primary">{title}</h2>
      {error === undefined ? null : (
        <p role="alert" className="min-w-0 truncate text-xs text-danger">
          {error.message}
        </p>
      )}
      <span className="ml-auto flex shrink-0 gap-1">
        {agent !== undefined && canStop(agent.state) ? (
          <Button variant="ghost" size="sm" disabled={!connected || actions.pending} onClick={actions.stop}>
            <Square />
            Stop
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={!connected}
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
          Delete
        </Button>
      </span>
      <DeleteAgentDialog title={title} open={confirming} onOpenChange={setConfirming} actions={actions} />
    </header>
  );
};
