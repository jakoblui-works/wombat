// The views' reads: thin glue over the queries in query-client.ts.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ConnectionState } from "../../../shared/bridge.ts";
import { agentLogQuery, agentsQuery, harnessesQuery, reposQuery } from "./query-client.ts";

export const useAgents = () => useQuery(agentsQuery());

export const useHarnesses = () => useQuery(harnessesQuery());

/** The folders an agent may start in; read again each time the caller mounts (the New agent dialog opening). */
export const useRepos = () => useQuery({ ...reposQuery(), refetchOnMount: "always" });

export const useAgentLog = (agentId: string) => useQuery(agentLogQuery(useQueryClient(), agentId));

/** The bridge's connection state; views dim themselves while it isn't `connected`. */
export const useConnection = (): ConnectionState => {
  const [state, setState] = useState<ConnectionState>({ state: "connecting" });
  // onConnection calls back at once with the current state.
  useEffect(() => window.wombat.service.onConnection(setState), []);
  return state;
};
