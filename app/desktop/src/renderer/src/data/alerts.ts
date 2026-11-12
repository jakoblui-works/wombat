// Keeps the cache current from the service's alerts. The event stream never replays, so after a reconnect the agents
// and proposals are read again and every cached log is read on from its cursor. While not connected nothing is
// cleared: views keep the last data and dim themselves.
import { hashKey, type QueryClient } from "@tanstack/react-query";

import type { Alert, ListAgentsResponse } from "@wombat/shared/api";
import type { ConnectionState, WombatBridge } from "../../../shared/bridge.ts";
import { keys, logAgentId } from "./keys.ts";
import { forgetAgent } from "./query-client.ts";
import { refresh } from "./refresh.ts";

/** Keeps the cache current from the bridge's alerts and connection states; returns the unsubscribe. */
export const connectAlerts = (queryClient: QueryClient, bridge: WombatBridge): (() => void) => {
  const cachedLogs = (): string[] =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: keys.logs })
      .flatMap((query) => logAgentId(query.queryKey) ?? []);

  // The store the cached data comes from: the dbId of the agents list, or of the alerts since it was reset.
  let store = queryClient.getQueryData<ListAgentsResponse>(keys.agents)?.dbId;
  /** False for another store than the cache's: then every query is reset (the reads under way are cancelled). */
  const sameStore = (dbId: string): boolean => {
    if (store === undefined || store === dbId) {
      store = dbId;
      return true;
    }
    // Every cached seq and id may mean something else now.
    store = undefined;
    void queryClient.resetQueries();
    return false;
  };

  const agentsHash = hashKey(keys.agents);
  const offCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== agentsHash) return;
    sameStore((event.action.data as ListAgentsResponse).dbId);
  });

  const onAlert = (alert: Alert): void => {
    if (!sameStore(alert.dbId)) return;
    switch (alert.type) {
      case "agent_added":
      case "agent_changed":
        void refresh(queryClient, keys.agents);
        break;
      case "agent_removed":
        forgetAgent(queryClient, alert.agentId);
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
    for (const agentId of cachedLogs()) if (!listed.has(agentId)) forgetAgent(queryClient, agentId);
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
        void refresh(queryClient, keys.proposals);
        for (const agentId of cachedLogs()) void refresh(queryClient, keys.log(agentId));
      }
      seenConnected = true;
    }
    previous = state;
  };

  const offAlert = bridge.service.onAlert(onAlert);
  const offConnection = bridge.service.onConnection(onConnection);
  return () => {
    offCache();
    offAlert();
    offConnection();
  };
};
