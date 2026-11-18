// The page's QueryClient and its queries: how each key is read.
import { type FetchQueryOptions, hashKey, QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import {
  ListAgentsResponse,
  ListHarnessesResponse,
  ListItemsResponse,
  ListLogResponse,
  ListReposResponse,
  ListBindersResponse,
  parseLogEntry,
} from "@wombat/shared/api";
import type { FoldEntry } from "@wombat/shared/log-fold";
import { ListProposalsResponse, ProposalDetail } from "@wombat/shared/proposals";
import { bySeq } from "./by-seq.ts";
import { call } from "./client.ts";
import { keys, logAgentId, proposalIdOf, binderIdOf } from "./keys.ts";

/** A parsed entry, or an unreadable one kept in its place (the log fold's entry). */
export type AgentLogEntry = FoldEntry;

/** What `keys.log(agentId)` holds: the agent's entries sorted by seq, unique by seq. */
export type AgentLog = { dbId: string; entries: AgentLogEntry[]; truncated: boolean };

/** The app's one QueryClient. */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      // Alerts say when something changed and a reconnect catches up (data/refresh.ts), so nothing refetches on a
      // timer, on focus or on mount, and a failed read waits for the next alert or connection instead of retrying.
      queries: { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false },
    },
  });

const readAgents = () => call("GET", "/agents", ListAgentsResponse);
const readHarnesses = () => call("GET", "/harnesses", ListHarnessesResponse);
const readRepos = () => call("GET", "/repos", ListReposResponse);
const readProposals = () => call("GET", "/proposals", ListProposalsResponse);
const readBinders = () => call("GET", "/binders", ListBindersResponse);
const readBinderItems = (binderId: string) => () => call("GET", `/binders/${encodeURIComponent(binderId)}/items`, ListItemsResponse);

/** A proposal's route: its detail, and the prefix of its commands. */
export const proposalPath = (proposalId: string): string => `/proposals/${encodeURIComponent(proposalId)}`;

const readProposal = (proposalId: string, version?: number) => () =>
  call("GET", version === undefined ? proposalPath(proposalId) : `${proposalPath(proposalId)}?version=${String(version)}`, ProposalDetail);

export const agentsQuery = () => queryOptions({ queryKey: keys.agents, queryFn: readAgents });
export const harnessesQuery = () => queryOptions({ queryKey: keys.harnesses, queryFn: readHarnesses });
export const reposQuery = () => queryOptions({ queryKey: keys.repos, queryFn: readRepos });
export const proposalsQuery = () => queryOptions({ queryKey: keys.proposals, queryFn: readProposals });
export const proposalQuery = (proposalId: string) => queryOptions({ queryKey: keys.proposal(proposalId), queryFn: readProposal(proposalId) });
/** The items' binders, hidden ones included. */
export const bindersQuery = () => queryOptions({ queryKey: keys.binders, queryFn: readBinders });
/** One binder's items, without their bodies. */
export const binderItemsQuery = (binderId: string) => queryOptions({ queryKey: keys.binderItems(binderId), queryFn: readBinderItems(binderId) });
/** One version of a proposal (`?version=`); its `current` is the target as it was at the read. */
export const proposalVersionQuery = (proposalId: string, version: number) =>
  queryOptions({ queryKey: keys.proposalVersion(proposalId, version), queryFn: readProposal(proposalId, version) });

/** Entries asked for per log read. */
export const LOG_PAGE_LIMIT = 500;

// Entries are parsed one by one (readEntry), so one bad entry doesn't fail the page; the raw seqs decide paging, since
// entries this app doesn't know are dropped.
const LogPage = ListLogResponse.extend({ entries: z.array(z.looseObject({ seq: z.int().nonnegative(), at: z.unknown() })) });

const readPage = (agentId: string, after: number) =>
  call("GET", `/agents/${encodeURIComponent(agentId)}/log?after=${String(after)}&limit=${String(LOG_PAGE_LIMIT)}`, LogPage);

const readEntry = (raw: { seq: number; at: unknown }): AgentLogEntry | undefined => {
  try {
    return parseLogEntry(raw);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return { type: "unreadable", seq: raw.seq, at: typeof raw.at === "string" ? raw.at : "" };
  }
};

const lastSeq = (entries: AgentLogEntry[]): number => entries.at(-1)?.seq ?? 0;

/**
 * `useAgentLog`'s query function, the non-hook seam: reads the agent's log through the client, paging with an
 * explicit limit; with `cached` (same dbId) it reads from the cached cursor and appends, with another dbId it reloads
 * from 0.
 */
export const agentLogQueryFn = async (agentId: string, cached?: AgentLog): Promise<AgentLog> => {
  let log: AgentLog | undefined = cached;
  let after = cached ? lastSeq(cached.entries) : 0;
  for (;;) {
    const page = await readPage(agentId, after);
    if (log !== undefined && page.dbId !== log.dbId) {
      // Another store: its seqs number other entries, so nothing cached applies.
      log = undefined;
      after = 0;
      continue;
    }
    const read = page.entries.flatMap((raw) => readEntry(raw) ?? []);
    log = { dbId: page.dbId, entries: bySeq([...(log?.entries ?? []), ...read]), truncated: (log?.truncated ?? false) || page.truncated };
    const next = Math.max(after, ...page.entries.map((raw) => raw.seq));
    // A full page that didn't move the cursor would be asked for again forever.
    if (page.entries.length < LOG_PAGE_LIMIT || next <= after) return log;
    after = next;
  }
};

/** Each read appends to what the cache holds when it starts. */
const readAgentLog = (queryClient: QueryClient, agentId: string) => () =>
  agentLogQueryFn(agentId, queryClient.getQueryData<AgentLog>(keys.log(agentId)));

/** The log query of one agent. */
export const agentLogQuery = (queryClient: QueryClient, agentId: string) =>
  queryOptions({ queryKey: keys.log(agentId), queryFn: readAgentLog(queryClient, agentId) });

/** The read of `key` again, through its query options above; undefined for a key the page has no query for. */
export const queryFor = (queryClient: QueryClient, key: QueryKey): (() => Promise<unknown>) | undefined => {
  // Stale or not: the caller knows it changed.
  const again = <T, K extends QueryKey>(options: FetchQueryOptions<T, Error, T, K> & { queryKey: K }) => ({
    queryKey: options.queryKey,
    read: () => queryClient.fetchQuery({ ...options, staleTime: 0 }),
  });
  const agentId = logAgentId(key);
  if (agentId !== undefined) return again(agentLogQuery(queryClient, agentId)).read;
  const proposalId = proposalIdOf(key);
  if (proposalId !== undefined) return again(proposalQuery(proposalId)).read;
  const binderId = binderIdOf(key);
  if (binderId !== undefined) return again(binderItemsQuery(binderId)).read;
  const lists = [again(agentsQuery()), again(harnessesQuery()), again(reposQuery()), again(proposalsQuery()), again(bindersQuery())];
  return lists.find((list) => hashKey(list.queryKey) === hashKey(key))?.read;
};

/** The one way an agent's cached data goes (it was removed or deleted, or is no longer listed). */
export const forgetAgent = (queryClient: QueryClient, agentId: string): void => {
  queryClient.removeQueries({ queryKey: keys.log(agentId), exact: true });
};
