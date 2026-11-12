import type { AgentSummary } from "@wombat/shared/api";

import { needsMe } from "../../../data/needs-me.ts";
import { ago } from "../../../lib/ago";
import { agentTitle } from "../Chat/chat-params.ts";

/** What a waiting agent without an open request shows as its ask. */
export const WAITING_ASK = "Waiting for you";

export type NeedsMeRow = {
  /** Unique among the rows: the agent, and the request when there is one. */
  key: string;
  agentId: string;
  requestId: string | undefined;
  agent: AgentSummary | undefined;
  title: string;
  ask: string;
  /** The pending permission's tool kind; undefined for a waiting agent without a request. */
  kind: AgentSummary["pendingPermissions"][number]["kind"] | undefined;
  ago: string;
};

/** The sidebar's rows, from `needsMe` only: newest first. */
export const needsMeRows = (agents: AgentSummary[], now: number): NeedsMeRow[] =>
  needsMe(agents).map((item) => {
    const agent = agents.find(({ id }) => id === item.agentId);
    const requestId = "requestId" in item ? item.requestId : undefined;
    return {
      key: `${item.agentId}:${requestId ?? ""}`,
      agentId: item.agentId,
      requestId,
      agent,
      title: agentTitle(item.agentId, agent),
      ask: "title" in item ? item.title : WAITING_ASK,
      kind: agent?.pendingPermissions.find((request) => request.requestId === requestId)?.kind,
      ago: ago(item.at, now),
    };
  });
