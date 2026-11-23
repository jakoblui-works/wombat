import type { AgentSummary } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";

import { needsMe } from "../../../data/needs-me.ts";
import { ago } from "../../../lib/ago";
import { agentTitle } from "../../../lib/agent-title.ts";
import { type ProposalRow, proposalRows } from "./proposal-rows.ts";

/** What a waiting agent without an open request shows as its ask. */
export const WAITING_ASK = "Waiting for you";

export type RequestRow = {
  type: "request";
  /** Unique among the rows: the agent, and the request when there is one. */
  key: string;
  workspace: string;
  at: string;
  agentId: string;
  requestId: string | undefined;
  agent: AgentSummary;
  title: string;
  ask: string;
  /** The pending permission's tool kind; undefined for a waiting agent without a request. */
  kind: AgentSummary["pendingPermissions"][number]["kind"] | undefined;
  ago: string;
};

export type NeedsMeRow = RequestRow | ProposalRow;

/** The request rows, from `needsMe` only: newest first. */
export const needsMeRows = (agents: AgentSummary[], now: number): RequestRow[] =>
  needsMe(agents).flatMap((item): RequestRow[] => {
    const agent = agents.find(({ id }) => id === item.agentId);
    if (agent === undefined) return [];
    const requestId = "requestId" in item ? item.requestId : undefined;
    return [
      {
        type: "request",
        key: `${item.agentId}:${requestId ?? ""}`,
        workspace: agent.workspace,
        at: item.at,
        agentId: item.agentId,
        requestId,
        agent,
        title: agentTitle(item.agentId, agent),
        ask: "title" in item ? item.title : WAITING_ASK,
        kind: agent.pendingPermissions.find((request) => request.requestId === requestId)?.kind,
        ago: ago(item.at, now),
      },
    ];
  });

/** Needs me's one list: the requests and the open proposals of every workspace, newest first. */
export const allRows = (agents: AgentSummary[], proposals: readonly Proposal[], now: number): NeedsMeRow[] =>
  [...needsMeRows(agents, now), ...proposalRows(proposals, agents, now)].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
