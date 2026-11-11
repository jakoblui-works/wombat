import type { AgentSummary } from "@wombat/shared/api";
import { Ellipsis, GitBranch } from "lucide-react";
import { useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { AGENT_STATES } from "../../../lib/agent-state";
import { ago } from "../../../lib/ago";
import { cn } from "../../../lib/utils";
import { agentTitle } from "../Chat/chat-params.ts";
import { useActionError } from "../Chat/DeleteAgentDialog/action-error.ts";
import { DeleteAgentDialog } from "../Chat/DeleteAgentDialog/DeleteAgentDialog.tsx";
import { canStop, useAgentActions } from "./agent-actions.ts";

type Props = {
  agent: AgentSummary;
  /** What a "." folder is called: the workspace folder's name. */
  workspaceName: string;
  now: number;
  selected: boolean;
  onOpen: () => void;
};

/** One agent: the row opens its chat; the menu beside it stops or deletes the agent. */
export const AgentRow = ({ agent, workspaceName, now, selected, onOpen }: Props) => {
  const state = AGENT_STATES[agent.state];
  const title = agentTitle(agent.id, agent);
  const actions = useAgentActions(agent.id);
  const [confirming, setConfirming] = useState(false);
  const error = useActionError(actions.error, agent.state, confirming);

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "focus-ring flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2",
          selected && "bg-surface-2",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />
          <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-primary">{title}</span>
          <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{ago(agent.lastUserAt ?? agent.startedAt, now)}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-5.5 font-mono text-xs text-fg-tertiary">
          <span className="shrink-0">{agent.repo === "." ? workspaceName : agent.repo}</span>
          {agent.branch === undefined ? null : (
            <>
              <GitBranch aria-label="branch" className="size-3 shrink-0" />
              <span className="truncate">{agent.branch}</span>
            </>
          )}
        </span>
        {agent.lastText === undefined ? null : <span className="line-clamp-2 pl-5.5 text-sm text-fg-secondary">{agent.lastText}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Agent actions"
          className="focus-ring absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-surface-3 text-fg-secondary opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-popup-open:opacity-100"
        >
          <Ellipsis className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {canStop(agent.state) ? <DropdownMenuItem onClick={actions.stop}>Stop</DropdownMenuItem> : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirming(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error === undefined ? null : (
        <p role="alert" className="px-2.5 pt-0.5 pl-8 text-xs text-danger">
          {error.message}
        </p>
      )}
      <DeleteAgentDialog title={title} open={confirming} onOpenChange={setConfirming} actions={actions} />
    </div>
  );
};
