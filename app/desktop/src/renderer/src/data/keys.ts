// The page's query keys. `logs` is the prefix of every `log(agentId)`, for finding the cached logs.
import type { QueryKey } from "@tanstack/react-query";

const LOG = "log";

export const keys = {
  agents: ["agents"],
  harnesses: ["harnesses"],
  repos: ["repos"],
  proposals: ["proposals"],
  logs: [LOG],
  log: (agentId: string) => [LOG, agentId],
  proposal: (proposalId: string) => ["proposal", proposalId],
} as const satisfies Record<string, QueryKey | ((id: string) => QueryKey)>;

/** The proposal a `keys.proposal(id)` key names; undefined for any other key. */
export const proposalIdOf = (key: QueryKey): string | undefined => (key[0] === "proposal" && typeof key[1] === "string" ? key[1] : undefined);

/** The agent a `keys.log(agentId)` key names; undefined for any other key. */
export const logAgentId = (key: QueryKey): string | undefined => (key[0] === LOG && typeof key[1] === "string" ? key[1] : undefined);
