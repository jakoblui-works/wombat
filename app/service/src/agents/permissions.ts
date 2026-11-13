import { randomUUID } from "node:crypto";

import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { AgentErrorCode, AnswerPermissionRequest, LogEntry } from "@wombat/shared/api";
import { permissionOf, UNKNOWN_PERMISSION } from "@wombat/shared/log-fold";

import type { Log } from "../log.ts";
import type { AgentProcess } from "./agent-process.ts";
import type { AgentRecord } from "./agent-record.ts";
import { AgentError, requireAgent, type AssertOpen } from "./errors.ts";
import { isHidden, recordsAgent } from "./phase.ts";
import { now, type PendingPermission, type PermissionKind, type Proc } from "./proc.ts";

/**
 * The summary rows of the agent's open permission requests: the only source of `pendingPermissions`. Title and kind
 * are the fold's; a request whose entry couldn't be stored has none to read and gets `UNKNOWN_PERMISSION`.
 */
export const pendingPermissions = (proc: Proc | undefined): PendingPermission[] =>
  [...(proc?.pending ?? [])].map(([requestId, { at }]) => {
    const { title, kind } = (proc?.fold && permissionOf(proc.fold, requestId)) ?? UNKNOWN_PERMISSION;
    return { requestId, at, title, kind };
  });

export type PermissionsDeps = {
  log: Log;
  assertOpen: AssertOpen;
  summaryOf: AgentRecord["summaryOf"];
  procOf: AgentProcess["procOf"];
  appendLog: AgentRecord["appendLog"];
  setState: AgentRecord["setState"];
  safely: AgentRecord["safely"];
};

/** The agents' permission requests: asked by the agent, answered by the user or cancelled. */
export const createPermissions = ({ log, assertOpen, summaryOf, procOf, appendLog, setState, safely }: PermissionsDeps) => {
  const requestPermission = (proc: Proc, request: RequestPermissionRequest) => {
    const { agentId } = proc;
    const { sessionId } = request;
    const requestId = randomUUID();
    // A hidden turn leaves no trace, and nobody could answer: the agent gets `cancelled`.
    if (isHidden(proc.phase)) {
      log("permission_hidden", { agentId, requestId });
      return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: "cancelled" } });
    }
    const offered = new Map<PermissionKind, string>();
    for (const option of request.options) {
      const kind = AnswerPermissionRequest.shape.kind.safeParse(option.kind);
      if (kind.success && !offered.has(kind.data)) offered.set(kind.data, option.optionId);
    }
    const parsed = LogEntry.safeParse({
      type: "permission_requested",
      seq: 0,
      agentId,
      at: now(),
      sessionId,
      requestId,
      toolCall: request.toolCall,
      options: request.options.map((option) => ({ kind: option.kind, name: option.name })),
    });
    if (!recordsAgent(proc.phase) || !parsed.success || parsed.data.type !== "permission_requested" || offered.size === 0) {
      log("permission_invalid", { agentId, requestId });
      return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: "cancelled" } });
    }
    const { toolCall, options, at } = parsed.data;
    return new Promise<RequestPermissionResponse>((respond) => {
      proc.pending.set(requestId, { offered, sessionId, respond, at });
      safely(agentId, "permission_requested", () => {
        appendLog(proc, [{ type: "permission_requested", at, sessionId, requestId, toolCall, options }]);
        setState(proc, "waiting");
      });
      log("permission_requested", { agentId, requestId, options: offered.size });
    });
  };

  /** Answers every open permission request with ACP's `cancelled`; no permission_answered is written. */
  const cancelPending = (proc: Proc) => {
    const pending = [...proc.pending.values()];
    proc.pending.clear();
    for (const request of pending) request.respond({ outcome: { outcome: "cancelled" } });
    return pending.length;
  };

  const answer = (agentId: string, requestId: string, kind: PermissionKind) => {
    assertOpen();
    requireAgent(agentId, summaryOf);
    const proc = procOf(agentId);
    const pending = proc?.pending.get(requestId);
    if (!proc || !pending) {
      throw new AgentError(
        AgentErrorCode.enum.not_found,
        `There's no open permission request ${requestId} for this agent: it was answered or cancelled, or never asked. Fetch the agent's log for the current one.`,
      );
    }
    const optionId = pending.offered.get(kind);
    if (optionId === undefined) {
      throw new AgentError(
        AgentErrorCode.enum.kind_not_offered,
        `The agent didn't offer ${kind} for this request. Answer with one of: ${[...pending.offered.keys()].join(", ")}.`,
      );
    }
    // Stored first: if that fails the request stays open, and the caller can answer it again.
    const at = now();
    appendLog(proc, [{ type: "permission_answered", at, sessionId: pending.sessionId, requestId, kind }]);
    proc.pending.delete(requestId);
    const state = proc.pending.size === 0 ? "working" : "waiting";
    safely(agentId, "permission_answered", () => setState(proc, state, { lastUserAt: at }));
    log("permission_answered", { agentId, requestId, kind });
    pending.respond({ outcome: { outcome: "selected", optionId } });
  };

  return { requestPermission, cancelPending, answer };
};

export type Permissions = ReturnType<typeof createPermissions>;
