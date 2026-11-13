import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { AgentSummary, AnswerPermissionRequest, ConfigOption, ContextBreakdown } from "@wombat/shared/api";
import { permissionOf, UNKNOWN_PERMISSION, type FoldState } from "@wombat/shared/log-fold";

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

/**
 * The summary rows of the agent's open permission requests: the only source of `pendingPermissions`. Title and kind
 * are the fold's; a request whose entry couldn't be stored has none to read and gets `UNKNOWN_PERMISSION`.
 */
export const pendingPermissions = (proc: Proc | undefined): PendingPermission[] =>
  [...(proc?.pending ?? [])].map(([requestId, { at }]) => {
    const { title, kind } = (proc?.fold && permissionOf(proc.fold, requestId)) ?? UNKNOWN_PERMISSION;
    return { requestId, at, title, kind };
  });

/** A harness waiting for one of the agent's extension notifications (see `ContextAgent.nextExt`). */
export type ExtWaiter = { method: string; match: (params: unknown) => boolean; resolve: (params: unknown) => void; reject: (error: Error) => void };

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
  /** The key of the agent's /mcp token in the live token map, once minted; deleted when the token is revoked. */
  tokenKey: string | undefined;
  closed: Promise<void>;
  sessionId: string;
  /**
   * A turn is open from send until its `turn_ended` is written; once the connection closes or the service is ending
   * the process, only the close handler ends it. A hidden turn (`contextBreakdown`) is moved only by `hiddenReport`:
   * meanwhile the agent's updates are dropped, and messages and config changes answer `busy`.
   */
  phase: AgentPhase;
  /** Updates that arrived before the agent's summary was stored. */
  held: { sessionId: string; update: unknown }[];
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
  skipped: number;
  /** The context report being made, which every request meanwhile shares; cleared once it settles. */
  contextReport: Promise<ContextBreakdown> | undefined;
  /**
   * The agent's config sets, one after another: each is checked against the options the one before it stored, and a
   * set's answer never mixes with the next one's request.
   */
  setting: Promise<void>;
  /** The prompt cache as the harness last reported it (`AgentSummary.cache`); in memory only. */
  cache: CacheState | null;
  /** Harnesses waiting for extension notifications; rejected when the process ends. */
  extWaiters: Set<ExtWaiter>;
};
