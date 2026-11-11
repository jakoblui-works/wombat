import { useDeleteAgent, useStopAgent } from "../../../data/commands.ts";

/** Whether the agent has a process to stop: only a working or waiting agent does. */
export const canStop = (state: string): boolean => state === "working" || state === "waiting";

/** Stopping and deleting one agent: the one place the agent list's row menu and the chat's header call. */
export const useAgentActions = (agentId: string) => {
  const stopping = useStopAgent();
  const deleting = useDeleteAgent();
  return {
    /** Stops the agent's process (its history stays). */
    stop: (): void => stopping.mutate(agentId),
    /** Deletes the agent and its history; settles once the service answered, rejects with its error. */
    remove: (): Promise<void> => deleting.mutateAsync(agentId),
    /** The last stop's or delete's failure. */
    error: stopping.error ?? deleting.error ?? undefined,
    pending: stopping.isPending || deleting.isPending,
  };
};
