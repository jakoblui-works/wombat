// The page's query keys. `logs` is the prefix of every `log(agentId)` and `proposalDetails` of every
// `proposal(proposalId)`, for finding the cached ones.
import type { QueryKey } from "@tanstack/react-query";

const LOG = "log";
const PROPOSAL = "proposal";
const PROPOSAL_VERSION = "proposal-version";
const STRUCTURE_ITEMS = "structure-items";

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
  structures: ["structures"],
  structureItems: (structureId: string) => [STRUCTURE_ITEMS, structureId],
} as const satisfies Record<string, QueryKey | ((id: string, version: number) => QueryKey)>;

/** The proposal a `keys.proposal(id)` key names; undefined for any other key. */
export const proposalIdOf = (key: QueryKey): string | undefined => (key[0] === PROPOSAL && typeof key[1] === "string" ? key[1] : undefined);

/** The structure a `keys.structureItems(structureId)` key names; undefined for any other key. */
export const structureIdOf = (key: QueryKey): string | undefined => (key[0] === STRUCTURE_ITEMS && typeof key[1] === "string" ? key[1] : undefined);

/** The agent a `keys.log(agentId)` key names; undefined for any other key. */
export const logAgentId = (key: QueryKey): string | undefined => (key[0] === LOG && typeof key[1] === "string" ? key[1] : undefined);
