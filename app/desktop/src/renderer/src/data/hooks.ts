// The panels' reads: thin glue over the queries in query-client.ts.
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ConnectionState } from "../../../shared/bridge.ts";
import { agentLogQuery, agentsQuery, harnessesQuery, proposalQuery, proposalsQuery, proposalVersionQuery, reposQuery, binderItemsQuery, bindersQuery, itemQuery, workspacesQuery } from "./query-client.ts";

// The workspace-keyed reads take `ws` undefined while no workspace is known: the query waits, keyed by "".
const NONE = "";

export const useAgents = () => useQuery(agentsQuery());

export const useHarnesses = () => useQuery(harnessesQuery());

export const useWorkspaces = () => useQuery(workspacesQuery());

/** Workspace `ws`'s folders an agent may start in; read again each time the caller mounts (the New agent dialog opening). */
export const useRepos = (ws: string | undefined) => useQuery({ ...reposQuery(ws ?? NONE), enabled: ws !== undefined, refetchOnMount: "always" });

export const useProposals = () => useQuery(proposalsQuery());

/**
 * One proposal with its versions and the current version's content, read again by an alert for this proposal and
 * after a reconnect; with `version`, that version's content instead, read once.
 */
export const useProposal = (proposalId: string, version?: number) =>
  useQuery(version === undefined ? proposalQuery(proposalId) : proposalVersionQuery(proposalId, version));

/** Workspace `ws`'s binders. */
export const useBinders = (ws: string | undefined) => useQuery({ ...bindersQuery(ws ?? NONE), enabled: ws !== undefined });

/** The items of each of workspace `ws`'s binders in `binderIds`, in that order. */
export const useBinderItems = (ws: string | undefined, binderIds: readonly string[]) =>
  useQueries({ queries: binderIds.map((binderId) => ({ ...binderItemsQuery(ws ?? NONE, binderId), enabled: ws !== undefined })) });

/**
 * One item of workspace `ws` by id, read again by every items alert of its workspace and after a reconnect. A failed
 * read keeps the item from the last read that succeeded as `data`, beside the error.
 */
export const useItem = (ws: string | undefined, itemId: string, { enabled = true, retryOnMount }: { enabled?: boolean; retryOnMount?: boolean } = {}) =>
  useQuery({ ...itemQuery(ws ?? NONE, itemId), enabled: enabled && ws !== undefined, ...(retryOnMount === undefined ? {} : { retryOnMount }) });

export const useAgentLog = (agentId: string) => useQuery(agentLogQuery(useQueryClient(), agentId));

/** The bridge's connection state; panels dim themselves while it isn't `connected`. */
export const useConnection = (): ConnectionState => {
  const [state, setState] = useState<ConnectionState>({ state: "connecting" });
  // onConnection calls back at once with the current state.
  useEffect(() => window.wombat.service.onConnection(setState), []);
  return state;
};
