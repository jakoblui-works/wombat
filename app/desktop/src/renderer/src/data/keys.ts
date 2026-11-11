// The page's query keys. `logs` is the prefix of every `log(agentId)`, for finding the cached logs.
import type { QueryKey } from "@tanstack/react-query";

const LOG = "log";

export const keys = {
  agents: ["agents"],
  harnesses: ["harnesses"],
  proposals: ["proposals"],
  logs: [LOG],
  log: (agentId: string) => [LOG, agentId],
} as const satisfies Record<string, QueryKey | ((agentId: string) => QueryKey)>;

/** The agent a `keys.log(agentId)` key names; undefined for any other key. */
export const logAgentId = (key: QueryKey): string | undefined => (key[0] === LOG && typeof key[1] === "string" ? key[1] : undefined);
