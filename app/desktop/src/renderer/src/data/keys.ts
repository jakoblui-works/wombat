// The page's query keys. `logs` is the prefix of every `log(agentId)`, `proposalDetails` of every
// `proposal(proposalId)`, `binderItemLists` of every `binderItems(binderId)` and `itemDetails` of every `item(ref)`,
// for finding the cached ones.
import type { QueryKey } from "@tanstack/react-query";

const LOG = "log";
const PROPOSAL = "proposal";
const PROPOSAL_VERSION = "proposal-version";
const BINDER_ITEMS = "binder-items";
const ITEM = "item";

export const keys = {
  agents: ["agents"],
  harnesses: ["harnesses"],
  repos: ["repos"],
  proposals: ["proposals"],
  logs: [LOG],
  log: (agentId: string) => [LOG, agentId],
  proposalDetails: [PROPOSAL],
  proposal: (proposalId: string) => [PROPOSAL, proposalId],
  // A version never changes once made, so nothing reads these again.
  proposalVersion: (proposalId: string, version: number) => [PROPOSAL_VERSION, proposalId, String(version)],
  binders: ["binders"],
  binderItemLists: [BINDER_ITEMS],
  binderItems: (binderId: string) => [BINDER_ITEMS, binderId],
  itemDetails: [ITEM],
  item: (ref: string) => [ITEM, ref],
} as const satisfies Record<string, QueryKey | ((id: string, version: number) => QueryKey)>;

/** The proposal a `keys.proposal(id)` key names; undefined for any other key. */
export const proposalIdOf = (key: QueryKey): string | undefined => (key[0] === PROPOSAL && typeof key[1] === "string" ? key[1] : undefined);

/** The binder a `keys.binderItems(binderId)` key names; undefined for any other key. */
export const binderIdOf = (key: QueryKey): string | undefined => (key[0] === BINDER_ITEMS && typeof key[1] === "string" ? key[1] : undefined);

/** The item a `keys.item(ref)` key names; undefined for any other key. */
export const itemRefOf = (key: QueryKey): string | undefined => (key[0] === ITEM && typeof key[1] === "string" ? key[1] : undefined);

/** The agent a `keys.log(agentId)` key names; undefined for any other key. */
export const logAgentId = (key: QueryKey): string | undefined => (key[0] === LOG && typeof key[1] === "string" ? key[1] : undefined);
