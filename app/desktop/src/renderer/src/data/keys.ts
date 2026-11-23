// The page's query keys. `logs` is the prefix of every `log(agentId)`, `proposalDetails` of every
// `proposal(proposalId)`, `repoLists` of every `repos(ws)`, `binderLists` of every `binders(ws)`, `binderItemLists`
// of every `binderItems(ws, binderId)` and `itemDetails` of every `item(ws, ref)`, for finding the cached ones;
// `workspaceItems(ws)` is the prefix of one workspace's binder item lists and items.
import type { QueryKey } from "@tanstack/react-query";

const LOG = "log";
const PROPOSAL = "proposal";
const PROPOSAL_VERSION = "proposal-version";
const REPOS = "repos";
const BINDERS = "binders";
const BINDER_ITEMS = "binder-items";
const ITEM = "item";

export const keys = {
  agents: ["agents"],
  harnesses: ["harnesses"],
  workspaces: ["workspaces"],
  repoLists: [REPOS],
  repos: (ws: string) => [REPOS, ws],
  proposals: ["proposals"],
  logs: [LOG],
  log: (agentId: string) => [LOG, agentId],
  proposalDetails: [PROPOSAL],
  proposal: (proposalId: string) => [PROPOSAL, proposalId],
  // A version never changes once made, so nothing reads these again.
  proposalVersion: (proposalId: string, version: number) => [PROPOSAL_VERSION, proposalId, String(version)],
  binderLists: [BINDERS],
  binders: (ws: string) => [BINDERS, ws],
  binderItemLists: [BINDER_ITEMS],
  workspaceBinderItems: (ws: string) => [BINDER_ITEMS, ws],
  binderItems: (ws: string, binderId: string) => [BINDER_ITEMS, ws, binderId],
  itemDetails: [ITEM],
  workspaceItems: (ws: string) => [ITEM, ws],
  item: (ws: string, ref: string) => [ITEM, ws, ref],
} as const satisfies Record<string, QueryKey | ((...args: never[]) => QueryKey)>;

/** The workspace id a workspace-keyed read is keyed by while no workspace is known (the query waits); it names nothing to read. */
export const NO_WORKSPACE = "";

const named = (key: QueryKey, prefix: string, at: number): string | undefined => {
  const value = key[at];
  return key[0] === prefix && key.length === at + 1 && typeof value === "string" && value !== NO_WORKSPACE && key.slice(1, at).every((part) => part !== NO_WORKSPACE)
    ? value
    : undefined;
};

/** The proposal a `keys.proposal(id)` key names; undefined for any other key. */
export const proposalIdOf = (key: QueryKey): string | undefined => named(key, PROPOSAL, 1);

/** The workspace a `keys.repos(ws)` key names; undefined for any other key. */
export const reposWorkspaceOf = (key: QueryKey): string | undefined => named(key, REPOS, 1);

/** The workspace a `keys.binders(ws)` key names; undefined for any other key. */
export const bindersWorkspaceOf = (key: QueryKey): string | undefined => named(key, BINDERS, 1);

/** The workspace and binder a `keys.binderItems(ws, binderId)` key names; undefined for any other key. */
export const binderIdOf = (key: QueryKey): { ws: string; binderId: string } | undefined => {
  const binderId = named(key, BINDER_ITEMS, 2);
  return binderId === undefined || typeof key[1] !== "string" ? undefined : { ws: key[1], binderId };
};

/** The workspace and item a `keys.item(ws, ref)` key names; undefined for any other key. */
export const itemRefOf = (key: QueryKey): { ws: string; ref: string } | undefined => {
  const ref = named(key, ITEM, 2);
  return ref === undefined || typeof key[1] !== "string" ? undefined : { ws: key[1], ref };
};

/** The agent a `keys.log(agentId)` key names; undefined for any other key. */
export const logAgentId = (key: QueryKey): string | undefined => named(key, LOG, 1);
