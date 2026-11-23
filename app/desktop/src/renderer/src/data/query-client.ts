// The page's QueryClient and its queries: how each key is read.
import { type FetchQueryOptions, hashKey, QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { parseLogEntry } from "@wombat/shared/api";
import type { FoldEntry } from "@wombat/shared/log-fold";
import { ROUTES } from "@wombat/shared/routes";
import { bySeq } from "./by-seq.ts";
import { callRoute, callRouteWith } from "./client.ts";
import { binderIdOf, bindersWorkspaceOf, itemRefOf, keys, logAgentId, proposalIdOf, reposWorkspaceOf } from "./keys.ts";

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

const readAgents = () => callRoute(ROUTES.listAgents);
const readHarnesses = () => callRoute(ROUTES.listHarnesses);
const readWorkspaces = () => callRoute(ROUTES.listWorkspaces);
const readRepos = (ws: string) => () => callRoute(ROUTES.listRepos, { params: { ws } });
const readProposals = () => callRoute(ROUTES.listProposals);
const readBinders = (ws: string) => () => callRoute(ROUTES.listBinders, { params: { ws } });
const readBinderItems = (ws: string, binderId: string) => () => callRoute(ROUTES.binderItems, { params: { ws, id: binderId } });
const readItem = (ws: string, ref: string) => () => callRoute(ROUTES.getItem, { params: { ws, ref } });

const readProposal = (proposalId: string, version?: number) => () =>
  callRoute(ROUTES.getProposal, { params: { id: proposalId }, query: version === undefined ? {} : { version } });

export const agentsQuery = () => queryOptions({ queryKey: keys.agents, queryFn: readAgents });
export const harnessesQuery = () => queryOptions({ queryKey: keys.harnesses, queryFn: readHarnesses });
/** The service's workspaces, in the order they were added. */
export const workspacesQuery = () => queryOptions({ queryKey: keys.workspaces, queryFn: readWorkspaces });
/** The folders an agent may start in, in workspace `ws`. */
export const reposQuery = (ws: string) => queryOptions({ queryKey: keys.repos(ws), queryFn: readRepos(ws) });
export const proposalsQuery = () => queryOptions({ queryKey: keys.proposals, queryFn: readProposals });
export const proposalQuery = (proposalId: string) => queryOptions({ queryKey: keys.proposal(proposalId), queryFn: readProposal(proposalId) });
/** Workspace `ws`'s binders, hidden ones included. */
export const bindersQuery = (ws: string) => queryOptions({ queryKey: keys.binders(ws), queryFn: readBinders(ws) });
/** One binder's items, without their bodies. */
export const binderItemsQuery = (ws: string, binderId: string) => queryOptions({ queryKey: keys.binderItems(ws, binderId), queryFn: readBinderItems(ws, binderId) });
/** One item of workspace `ws` with its body, by id, handle or old handle. */
export const itemQuery = (ws: string, ref: string) => queryOptions({ queryKey: keys.item(ws, ref), queryFn: readItem(ws, ref) });
/** One version of a proposal (`?version=`); its `current` is the target as it was at the read. */
export const proposalVersionQuery = (proposalId: string, version: number) =>
  queryOptions({ queryKey: keys.proposalVersion(proposalId, version), queryFn: readProposal(proposalId, version) });

/** Entries asked for per log read. */
export const LOG_PAGE_LIMIT = 500;

// Entries are parsed one by one (readEntry), so one bad entry doesn't fail the page; the raw seqs decide paging, since
// entries this app doesn't know are dropped.
const LogPage = ROUTES.agentLog.response.extend({ entries: z.array(z.looseObject({ seq: z.int().nonnegative(), at: z.unknown() })) });

const readPage = (agentId: string, after: number) =>
  callRouteWith(ROUTES.agentLog, { params: { id: agentId }, query: { after, limit: LOG_PAGE_LIMIT } }, LogPage);

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
  const reposOf = reposWorkspaceOf(key);
  if (reposOf !== undefined) return again(reposQuery(reposOf)).read;
  const bindersOf = bindersWorkspaceOf(key);
  if (bindersOf !== undefined) return again(bindersQuery(bindersOf)).read;
  const binder = binderIdOf(key);
  if (binder !== undefined) return again(binderItemsQuery(binder.ws, binder.binderId)).read;
  const item = itemRefOf(key);
  if (item !== undefined) return again(itemQuery(item.ws, item.ref)).read;
  const lists = [again(agentsQuery()), again(harnessesQuery()), again(workspacesQuery()), again(proposalsQuery())];
  return lists.find((list) => hashKey(list.queryKey) === hashKey(key))?.read;
};

/** The one way an agent's cached data goes (it was removed or deleted, or is no longer listed). */
export const forgetAgent = (queryClient: QueryClient, agentId: string): void => {
  queryClient.removeQueries({ queryKey: keys.log(agentId), exact: true });
};
