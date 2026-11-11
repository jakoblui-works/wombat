// Keeps the cache current from the service's alerts. The event stream never replays, so after a reconnect the agents
// are read again and every cached log is read on from its cursor. While not connected nothing is cleared: views keep
// the last data and dim themselves.
import type { QueryClient } from "@tanstack/react-query";

import type { Alert, ListAgentsResponse } from "@wombat/shared/api";
import type { ConnectionState, WombatBridge } from "../../../shared/bridge.ts";
import { keys, logAgentId } from "./keys.ts";
import { refresh } from "./refresh.ts";

/** Keeps the cache current from the bridge's alerts and connection states; returns the unsubscribe. */
export const connectAlerts = (queryClient: QueryClient, bridge: WombatBridge): (() => void) => {
  const cachedLogs = (): string[] =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: keys.logs })
      .flatMap((query) => logAgentId(query.queryKey) ?? []);

  const onAlert = (alert: Alert): void => {
    const agents = queryClient.getQueryData<ListAgentsResponse>(keys.agents);
    if (agents !== undefined && agents.dbId !== alert.dbId) {
      // Another store: every cached seq and id may mean something else now. Resetting cancels the reads under way.
      void queryClient.resetQueries();
      return;
    }
    switch (alert.type) {
      case "agent_added":
      case "agent_changed":
        void refresh(queryClient, keys.agents);
        break;
      case "agent_removed":
        queryClient.removeQueries({ queryKey: keys.log(alert.agentId) });
        void refresh(queryClient, keys.agents);
        break;
      case "log":
        void refresh(queryClient, keys.log(alert.agentId));
        break;
      case "proposal":
        void refresh(queryClient, keys.proposals);
        break;
    }
  };

  /** Removes the cached logs of agents the agents list no longer has (deleted while the stream was down). */
  const dropUnlisted = (): void => {
    const agents = queryClient.getQueryData<ListAgentsResponse>(keys.agents);
    if (agents === undefined) return;
    const listed = new Set(agents.agents.map((agent) => agent.id));
    for (const agentId of cachedLogs()) if (!listed.has(agentId)) queryClient.removeQueries({ queryKey: keys.log(agentId) });
  };

  let previous: ConnectionState["state"] | undefined;
  let seenConnected = false;
  const onConnection = ({ state }: ConnectionState): void => {
    if (state === "connected" && previous !== "connected") {
      // Reads that failed while not connected (the bridge refuses them), on the first connection too.
      for (const query of queryClient.getQueryCache().findAll({ predicate: ({ state }) => state.status === "error" && state.data === undefined })) {
        void refresh(queryClient, query.queryKey);
      }
      // The first connection loads through the queries themselves; only a later one has anything to catch up.
      if (seenConnected) {
        void refresh(queryClient, keys.agents).then(dropUnlisted);
        for (const agentId of cachedLogs()) void refresh(queryClient, keys.log(agentId));
      }
      seenConnected = true;
    }
    previous = state;
  };

  const offAlert = bridge.service.onAlert(onAlert);
  const offConnection = bridge.service.onConnection(onConnection);
  return () => {
    offAlert();
    offConnection();
  };
};
