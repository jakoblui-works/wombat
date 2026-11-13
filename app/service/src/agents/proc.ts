import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { AgentSummary, AnswerPermissionRequest, ConfigOption } from "@wombat/shared/api";
import type { FoldState } from "@wombat/shared/log-fold";

import type { CacheState, Harness } from "../harness/harness.ts";
import type { AcpAgent } from "./acp-client.ts";
import type { AgentPhase } from "./phase.ts";

export type PermissionKind = AnswerPermissionRequest["kind"];
export type PendingPermission = AgentSummary["pendingPermissions"][number];

export type Pending = Pick<PendingPermission, "at"> & {
  /** Option kind → the agent's optionId, for the kinds it offered. */
  offered: Map<PermissionKind, string>;
  /** The ACP session that asked; its answer is recorded under the same one. */
  sessionId: string;
  respond: (response: RequestPermissionResponse) => void;
};

export const now = () => new Date().toISOString();

/** One agent process, from spawn until it closed. */
export type Proc = {
  agentId: string;
  harness: Harness;
  /** The agent's HOME from its spawn environment, for its harness (`ContextAgent.home`). */
  home: string | undefined;
  /** The agent's folder. */
  cwd: string;
  pid: number | undefined;
  /** The agent's systemd scope, when it runs in one. */
  unit: string | undefined;
  /** Set once the process exited: killing its scope, which ends what outlived it there. */
  scopeKilled: Promise<void> | undefined;
  /** When the process exited (ms since the epoch); the close grace counts from here. */
  exitedAt: number | undefined;
  acp: AcpAgent;
  closed: Promise<void>;
  sessionId: string;
  /** Built only by `phase.ts`'s `next`. */
  phase: AgentPhase;
  /** Open permission requests by requestId, oldest first; the summary's pendingPermissions mirror it. */
  pending: Map<string, Pending>;
  /**
   * The current turn's entries folded as stored, for the summary's lastText and request titles and kinds; made once
   * the session id is known (the main session must be the real one), anew at each user message.
   */
  fold: FoldState | undefined;
  /** The latest stored main-session config options (`configOf`, kept across the fold's restarts); what a set is checked against. */
  config: ConfigOption[] | undefined;
  /** The command names of the latest stored main-session command list (`commandsOf`, kept across the fold's restarts). */
  commands: string[] | undefined;
  /** The prompt cache as the harness last reported it (`AgentSummary.cache`); in memory only. */
  cache: CacheState | null;
};
