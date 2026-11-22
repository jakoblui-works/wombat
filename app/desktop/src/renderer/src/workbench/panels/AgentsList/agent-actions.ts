import { hasProcess } from "@wombat/shared/api";

import { useDeleteAgent, useStopAgent } from "../../../data/commands.ts";
import { useAgents } from "../../../data/hooks.ts";
import { agentDeleted } from "../../shell/shell-state.ts";
import { useShell } from "../../shell/ShellProvider.tsx";

/** Whether the agent has a process to stop, whatever its state (a done agent's process still runs). */
export const canStop = hasProcess;

/** Stopping and deleting one agent: the one place the agent list's row menu and the chat's header call. */
export const useAgentActions = (agentId: string) => {
  const stopping = useStopAgent();
  const deleting = useDeleteAgent();
  const { change } = useShell();
  const workspace = useAgents().data?.agents.find(({ id }) => id === agentId)?.workspace;
  return {
    /** Stops the agent's process (its history stays). */
    stop: (): void => stopping.mutate(agentId),
    /** Deletes the agent and its history; settles once the service answered, rejects with its error. */
    remove: async (): Promise<void> => {
      await deleting.mutateAsync(agentId);
      change((state) => agentDeleted(state, agentId, workspace));
    },
    /** The last stop's or delete's failure. */
    error: stopping.error ?? deleting.error ?? undefined,
    pending: stopping.isPending || deleting.isPending,
  };
};
