// The views' reads: thin glue over the queries in query-client.ts.
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ConnectionState } from "../../../shared/bridge.ts";
import { agentLogQuery, agentsQuery, harnessesQuery, proposalQuery, proposalsQuery, proposalVersionQuery, reposQuery, structureItemsQuery, structuresQuery } from "./query-client.ts";

export const useAgents = () => useQuery(agentsQuery());

export const useHarnesses = () => useQuery(harnessesQuery());

/** The folders an agent may start in; read again each time the caller mounts (the New agent dialog opening). */
export const useRepos = () => useQuery({ ...reposQuery(), refetchOnMount: "always" });

export const useProposals = () => useQuery(proposalsQuery());

/**
 * One proposal with its versions and the current version's content, read again by an alert for this proposal and
 * after a reconnect; with `version`, that version's content instead, read once.
 */
export const useProposal = (proposalId: string, version?: number) =>
  useQuery(version === undefined ? proposalQuery(proposalId) : proposalVersionQuery(proposalId, version));

/** The items' structures; nothing announces their changes, so each caller's mount reads them again. */
export const useStructures = () => useQuery({ ...structuresQuery(), refetchOnMount: "always" });

/** The items of each structure in `structureIds`, in that order; read again on each caller's mount, like the structures. */
export const useStructureItems = (structureIds: readonly string[]) =>
  useQueries({ queries: structureIds.map((structureId) => ({ ...structureItemsQuery(structureId), refetchOnMount: "always" as const })) });

export const useAgentLog = (agentId: string) => useQuery(agentLogQuery(useQueryClient(), agentId));

/** The bridge's connection state; views dim themselves while it isn't `connected`. */
export const useConnection = (): ConnectionState => {
  const [state, setState] = useState<ConnectionState>({ state: "connecting" });
  // onConnection calls back at once with the current state.
  useEffect(() => window.wombat.service.onConnection(setState), []);
  return state;
};
