// The page's QueryClient and its queries: how each key is read.
import { hashKey, QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import {
  ListAgentsResponse,
  ListHarnessesResponse,
  ListLogResponse,
  ListProposalsResponse,
  type LogEntry,
  parseLogEntry,
} from "@wombat/shared/api";
import { call } from "./client.ts";
import { keys, logAgentId } from "./keys.ts";

/** A stored entry of a known type that fails its schema: kept in its place, without its content. */
export type UnreadableEntry = { type: "unreadable"; seq: number; at: string };

export type AgentLogEntry = LogEntry | UnreadableEntry;

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
const readProposals = () => call("GET", "/proposals", ListProposalsResponse);

export const agentsQuery = () => queryOptions({ queryKey: keys.agents, queryFn: readAgents });
export const harnessesQuery = () => queryOptions({ queryKey: keys.harnesses, queryFn: readHarnesses });
export const proposalsQuery = () => queryOptions({ queryKey: keys.proposals, queryFn: readProposals });

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

/** `entries` and `more` as one list, sorted by seq, unique by seq. */
const merged = (entries: AgentLogEntry[], more: AgentLogEntry[]): AgentLogEntry[] => {
  const bySeq = new Map<number, AgentLogEntry>();
  for (const entry of [...entries, ...more]) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

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
    log = { dbId: page.dbId, entries: merged(log?.entries ?? [], read), truncated: (log?.truncated ?? false) || page.truncated };
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

/** How `key` is read; undefined for a key the page has no query for. */
export const queryFor = (queryClient: QueryClient, key: QueryKey): { queryKey: QueryKey; queryFn: () => Promise<unknown> } | undefined => {
  const agentId = logAgentId(key);
  if (agentId !== undefined) return { queryKey: key, queryFn: readAgentLog(queryClient, agentId) };
  const lists: [QueryKey, () => Promise<unknown>][] = [
    [keys.agents, readAgents],
    [keys.harnesses, readHarnesses],
    [keys.proposals, readProposals],
  ];
  const found = lists.find(([listKey]) => hashKey(listKey) === hashKey(key));
  return found && { queryKey: key, queryFn: found[1] };
};
