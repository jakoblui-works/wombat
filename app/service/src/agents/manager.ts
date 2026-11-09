import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  AnswerPermissionRequest,
  Item,
  parseItem,
  type AgentSummary,
  type ErrorBody,
  type SendMessageRequest,
} from "@wombat/shared/api";

import { startAgentProcess, type Harness } from "../harness/harness.ts";
import { defaultHarnesses, findHarness } from "../harness/registry.ts";
import type { ItemEntry, Store } from "../store/store.ts";
import { RepoError, resolveRepo } from "../workspace.ts";
import { connectAgent, type AcpAgent } from "./acp-client.ts";

export type AgentErrorCode =
  | "not_found"
  | "busy"
  | "not_running"
  | "kind_not_offered"
  | "auth_required"
  | "unknown_harness"
  | "repo_not_found"
  | "repo_outside_workspace"
  | "agent_failed";

/** A failed manager call; the server maps `code` to its HTTP status. */
export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly hint: string | undefined;

  constructor(code: AgentErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.hint = hint;
  }
}

export type LogFields = Record<string, string | number | boolean>;
/** Service log lines carry ids, states and counts only, never prompts, replies, diffs, tool content or stderr. */
export type Log = (event: string, fields: LogFields) => void;

export type Committed = {
  seq: number;
  agentId: string;
  type: "agent_added" | "agent_changed" | "agent_removed" | "items";
};

export type ManagerOptions = {
  store: Store;
  /** Repo paths are relative to this folder, and must resolve inside it. */
  workspaceRoot: string;
  harnesses?: readonly Harness[];
  log?: Log;
  /** What each agent's environment is filtered from (see `agentEnv`). */
  env?: NodeJS.ProcessEnv;
};

type PermissionKind = AnswerPermissionRequest["kind"];
type ErrorDetail = ErrorBody["error"];

type Pending = {
  /** Option kind → the agent's optionId, for the kinds it offered. */
  offered: Map<PermissionKind, string>;
  respond: (response: RequestPermissionResponse) => void;
};

/** One agent process, from spawn until it closed. */
type Proc = {
  agentId: string;
  pid: number | undefined;
  acp: AcpAgent;
  closed: Promise<void>;
  sessionId: string;
  /** False until the agent's summary is stored; updates that arrive before are held. */
  recorded: boolean;
  held: { sessionId: string; update: unknown }[];
  /** Why the service is ending the process: "stop" keeps the agent (stopped), "remove" writes nothing. */
  ending: "stop" | "remove" | undefined;
  turn: boolean;
  pending: Map<string, Pending>;
  skipped: number;
};

const START_TIMEOUT_MS = 60_000;
/** How long an agent gets to exit after SIGTERM before its process group is killed. */
const KILL_GRACE_MS = 2_000;
/** How long after an agent exits its stdio may stay open (still being read) before the service drops it. */
const CLOSE_GRACE_MS = 500;
const ACP_AUTH_REQUIRED = -32000;

const now = () => new Date().toISOString();

const logToStderr: Log = (event, fields) => {
  process.stderr.write(`${JSON.stringify({ at: now(), event, ...fields })}\n`);
};

/** A protocol name (an update kind, a stop reason) fit for a log line; anything else is "unknown". */
const safeName = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "unknown");

const killGroup = (pid: number | undefined, signal: NodeJS.Signals) => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already.
  }
};

const rpcCode = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "number"
    ? (error as { code: number }).code
    : undefined;

const withTimeout = <T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const notFound = (agentId: string) =>
  new AgentError("not_found", `There's no agent ${agentId}. List the agents to see which exist.`);

const notRunning = () =>
  new AgentError(
    "not_running",
    "The agent isn't running (it was stopped or its process ended). Start a new agent to continue; its history is kept.",
  );

/**
 * Starts agents through their harness and records everything they do in the store before telling listeners,
 * so an alert never announces something that can't be read yet.
 */
export const createManager = ({
  store,
  workspaceRoot,
  harnesses = defaultHarnesses,
  log = logToStderr,
  env = process.env,
}: ManagerOptions) => {
  const listeners = new Set<(event: Committed) => void>();
  const summaries = new Map(store.listAgents().map((agent) => [agent.id, agent]));
  const procs = new Map<string, Proc>();
  // commandId → seq of its user_message, per agent; loaded from the store on first use.
  const commandIds = new Map<string, Map<string, number>>();
  let shuttingDown: Promise<void> | undefined;

  const emit = (event: Committed) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        log("listener_failed", { agentId: event.agentId, seq: event.seq, type: event.type });
      }
    }
  };

  const putSummary = (summary: AgentSummary, type: "agent_added" | "agent_changed") => {
    const seq = store.putAgent(summary);
    summaries.set(summary.id, summary);
    emit({ seq, agentId: summary.id, type });
  };

  const appendItems = (agentId: string, entries: ItemEntry[]) => {
    const seqs = store.append(agentId, entries);
    const last = seqs.at(-1);
    if (last !== undefined) emit({ seq: last, agentId, type: "items" });
    return seqs;
  };

  const setState = (agentId: string, state: AgentSummary["state"], error?: ErrorDetail) => {
    const current = summaries.get(agentId);
    if (!current) return;
    const next: AgentSummary = { ...current, state, lastActivityAt: now() };
    delete next.error;
    if (error) next.error = error;
    putSummary(next, "agent_changed");
    log("agent_state", { agentId, state });
  };

  /** For writes driven by the agent rather than a caller: a failure is logged, not thrown into the ACP layer. */
  const safely = (agentId: string, what: string, write: () => void) => {
    try {
      write();
    } catch {
      log("store_write_failed", { agentId, what });
    }
  };

  const assertOpen = () => {
    if (shuttingDown) {
      throw new AgentError(
        "not_running",
        "The agent service is shutting down and takes no more agent commands. Start the service again.",
      );
    }
  };

  const knownCommands = (agentId: string) => {
    let known = commandIds.get(agentId);
    if (!known) {
      known = new Map();
      for (const item of store.items(agentId).items) {
        if (item.type === "user_message" && item.commandId !== undefined) known.set(item.commandId, item.seq);
      }
      commandIds.set(agentId, known);
    }
    return known;
  };

  const handleUpdate = (proc: Proc, sessionId: string, update: unknown) => {
    if (!proc.recorded) {
      proc.held.push({ sessionId, update });
      return;
    }
    const { agentId } = proc;
    const kind = safeName((update as { sessionUpdate?: unknown } | null)?.sessionUpdate);
    let item: Item | undefined;
    try {
      item = parseItem({ type: "session_update", seq: 0, agentId, at: now(), update });
    } catch {
      log("update_invalid", { agentId, kind });
      return;
    }
    if (item?.type !== "session_update") {
      proc.skipped += 1;
      log("update_skipped", { agentId, kind, count: proc.skipped });
      return;
    }
    const parsed = item.update;
    safely(agentId, "session_update", () => {
      appendItems(agentId, [{ type: "session_update", update: parsed }]);
      if (parsed.sessionUpdate === "session_info_update" && typeof parsed.title === "string") {
        const current = summaries.get(agentId);
        if (current) putSummary({ ...current, title: parsed.title, lastActivityAt: now() }, "agent_changed");
      }
    });
  };

  const requestPermission = (proc: Proc, request: RequestPermissionRequest) => {
    const { agentId } = proc;
    const requestId = randomUUID();
    const offered = new Map<PermissionKind, string>();
    for (const option of request.options) {
      const kind = AnswerPermissionRequest.shape.kind.safeParse(option.kind);
      if (kind.success && !offered.has(kind.data)) offered.set(kind.data, option.optionId);
    }
    const parsed = Item.safeParse({
      type: "permission_requested",
      seq: 0,
      agentId,
      at: now(),
      requestId,
      toolCall: request.toolCall,
      options: request.options.map((option) => ({ kind: option.kind, name: option.name })),
    });
    if (!proc.recorded || !parsed.success || parsed.data.type !== "permission_requested" || offered.size === 0) {
      log("permission_invalid", { agentId, requestId });
      return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: "cancelled" } });
    }
    const { toolCall, options } = parsed.data;
    return new Promise<RequestPermissionResponse>((respond) => {
      proc.pending.set(requestId, { offered, respond });
      safely(agentId, "permission_requested", () => {
        appendItems(agentId, [{ type: "permission_requested", requestId, toolCall, options }]);
        setState(agentId, "waiting");
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

  const runTurn = async (proc: Proc, text: string) => {
    const { agentId } = proc;
    try {
      const { stopReason } = await proc.acp.prompt(proc.sessionId, text);
      proc.turn = false;
      cancelPending(proc);
      safely(agentId, "turn_ended", () => {
        appendItems(agentId, [{ type: "turn_ended", stopReason }]);
        setState(agentId, "done");
      });
      log("turn_ended", { agentId, stopReason: safeName(stopReason) });
    } catch (error) {
      proc.turn = false;
      cancelPending(proc);
      // The connection closed: the process ended, and its close handler records why.
      if (proc.acp.isClosed()) return;
      const code = rpcCode(error);
      safely(agentId, "turn_failed", () =>
        setState(agentId, "error", {
          code: "agent_failed",
          message:
            `The agent reported an error during the turn${code === undefined ? "" : ` (ACP error ${code})`}. ` +
            "Send the message again, or stop the agent and start a new one.",
        }),
      );
      log("turn_failed", { agentId, code: code ?? -1 });
    }
  };

  const spawnAgent = (agentId: string, harness: Harness, cwd: string): Proc => {
    const child: ChildProcessWithoutNullStreams = startAgentProcess(harness.spawn(cwd, env));
    const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
    const proc: Proc = {
      agentId,
      pid: child.pid,
      acp: connectAgent(child, {
        update: (sessionId, update) => handleUpdate(proc, sessionId, update),
        permission: (request) => requestPermission(proc, request),
      }),
      closed,
      sessionId: "",
      recorded: false,
      held: [],
      ending: undefined,
      turn: false,
      pending: new Map(),
      skipped: 0,
    };

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      procs.delete(agentId);
      proc.acp.close();
      cancelPending(proc);
      if (proc.recorded && proc.ending === "stop") {
        safely(agentId, "stopped", () => setState(agentId, "stopped"));
      } else if (proc.recorded && proc.ending === undefined) {
        const how = code === null ? `was killed (${signal ?? "unknown signal"})` : `exited with code ${code}`;
        safely(agentId, "exited", () =>
          setState(agentId, "error", {
            code: "agent_failed",
            message: `The agent process ${how} unexpectedly. Start a new agent to continue; this one's history is kept.`,
          }),
        );
      }
      log("agent_exited", { agentId, code: code ?? -1, signal: signal ?? "none" });
      markClosed();
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      log("agent_process_error", { agentId, code: error.code ?? "unknown" });
      // A process that never started emits no close.
      if (child.pid === undefined) finish(null, null);
    });
    let closeTimer: NodeJS.Timeout | undefined;
    child.once("exit", (code, signal) => {
      // Helpers the agent started (claude-agent-acp's native `claude`) share its group and must not outlive it.
      killGroup(child.pid, "SIGKILL");
      // `close` waits for every holder of the agent's stdio, and a helper in a group of its own may hold it for
      // good: past the grace period the pipes are dropped and the agent counts as ended.
      closeTimer = setTimeout(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code, signal);
      }, CLOSE_GRACE_MS);
    });
    child.once("close", (code, signal) => {
      clearTimeout(closeTimer);
      finish(code, signal);
    });
    return proc;
  };

  const terminate = async (proc: Proc) => {
    killGroup(proc.pid, "SIGTERM");
    const timer = setTimeout(() => killGroup(proc.pid, "SIGKILL"), KILL_GRACE_MS);
    try {
      await proc.closed;
    } finally {
      clearTimeout(timer);
    }
  };

  const startFailure = (error: unknown, harness: Harness, proc: Proc) => {
    if (error instanceof AgentError) return error;
    const code = rpcCode(error);
    if (code === ACP_AUTH_REQUIRED) {
      return new AgentError(
        "auth_required",
        `${harness.name} needs a login before it can start a session. Log in, then start the agent again.`,
        harness.loginHint,
      );
    }
    const what = proc.acp.isClosed()
      ? "The agent process ended before its session started"
      : `The agent refused to start a session${code === undefined ? "" : ` (ACP error ${code})`}`;
    return new AgentError("agent_failed", `${what}. Check that ${harness.name} is installed and runs, then try again.`);
  };

  // Agents stored by an earlier run have no process any more.
  let marked = 0;
  for (const agent of [...summaries.values()]) {
    if (agent.state === "working" || agent.state === "waiting" || agent.state === "done") {
      putSummary({ ...agent, state: "stopped" }, "agent_changed");
      log("agent_state", { agentId: agent.id, state: "stopped" });
      marked += 1;
    }
  }
  log("agents_loaded", { count: summaries.size, markedStopped: marked });

  const start = async (harnessId: string, repo: string): Promise<AgentSummary> => {
    assertOpen();
    const harness = findHarness(harnessId, harnesses);
    if (!harness) {
      throw new AgentError("unknown_harness", `There's no harness "${harnessId}". List the harnesses to see which exist.`);
    }
    let cwd: string;
    try {
      cwd = resolveRepo(workspaceRoot, repo);
    } catch (error) {
      if (error instanceof RepoError) throw new AgentError(error.code, error.message);
      throw error;
    }

    const agentId = randomUUID();
    const proc = spawnAgent(agentId, harness, cwd);
    procs.set(agentId, proc);
    log("agent_starting", { agentId, harness: harness.id });
    const tooSlow = () =>
      new AgentError(
        "agent_failed",
        `${harness.name} didn't start a session within ${START_TIMEOUT_MS / 1000} s. Check that it runs, then try again.`,
      );
    try {
      const deadline = Date.now() + START_TIMEOUT_MS;
      const initialized = await withTimeout(proc.acp.initialize(), START_TIMEOUT_MS, tooSlow);
      const sessionId = await withTimeout(proc.acp.newSession(cwd), Math.max(0, deadline - Date.now()), tooSlow);
      // procs no longer holding it means the process ended before its summary could be stored.
      if (shuttingDown || proc.ending || procs.get(agentId) !== proc) throw notRunning();
      proc.sessionId = sessionId;
      const startedAt = now();
      const summary: AgentSummary = {
        id: agentId,
        harness: harness.id,
        repo,
        state: "done",
        sessionId,
        capabilities: { loadSession: initialized.agentCapabilities?.loadSession ?? false },
        startedAt,
        lastActivityAt: startedAt,
      };
      putSummary(summary, "agent_added");
      proc.recorded = true;
      log("agent_started", { agentId, harness: harness.id });
      for (const { sessionId: from, update } of proc.held.splice(0)) handleUpdate(proc, from, update);
      return summaries.get(agentId) ?? summary;
    } catch (error) {
      const failure = startFailure(error, harness, proc);
      // Nothing was recorded, so the close handler writes nothing.
      proc.ending ??= "remove";
      await terminate(proc);
      log("agent_start_failed", { agentId, harness: harness.id, code: failure.code });
      throw failure;
    }
  };

  const sendNow = (agentId: string, { text, commandId }: SendMessageRequest): { seq: number } => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    if (commandId !== undefined) {
      const seq = knownCommands(agentId).get(commandId);
      if (seq !== undefined) {
        log("message_repeated", { agentId, seq });
        return { seq };
      }
    }
    const proc = procs.get(agentId);
    if (!proc?.recorded || proc.ending) throw notRunning();
    if (proc.turn) {
      throw new AgentError("busy", "The agent is still working on the last message. Wait for it to finish, or cancel it.");
    }
    const [seq = 0] = appendItems(agentId, [{ type: "user_message", text, ...(commandId === undefined ? {} : { commandId }) }]);
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(agentId, "working"));
    proc.turn = true;
    log("turn_started", { agentId, seq });
    void runTurn(proc, text);
    return { seq };
  };

  // Async for callers, while the checks, the commandId lookup and the store write stay in one synchronous step.
  const send = (agentId: string, request: SendMessageRequest) =>
    Promise.resolve().then(() => sendNow(agentId, request));

  const answer = (agentId: string, requestId: string, kind: PermissionKind) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    const pending = proc?.pending.get(requestId);
    if (!proc || !pending) {
      throw new AgentError(
        "not_found",
        `There's no open permission request ${requestId} for this agent: it was answered or cancelled, or never asked. Fetch the agent's items for the current one.`,
      );
    }
    const optionId = pending.offered.get(kind);
    if (optionId === undefined) {
      throw new AgentError(
        "kind_not_offered",
        `The agent didn't offer ${kind} for this request. Answer with one of: ${[...pending.offered.keys()].join(", ")}.`,
      );
    }
    // Stored first: if that fails the request stays open, and the caller can answer it again.
    appendItems(agentId, [{ type: "permission_answered", requestId, kind }]);
    proc.pending.delete(requestId);
    if (proc.pending.size === 0) safely(agentId, "permission_answered", () => setState(agentId, "working"));
    log("permission_answered", { agentId, requestId, kind });
    pending.respond({ outcome: { outcome: "selected", optionId } });
  };

  const cancel = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    if (!proc?.recorded || proc.ending) throw notRunning();
    try {
      await proc.acp.cancel(proc.sessionId);
    } catch {
      // The connection closed meanwhile; the close handler records it.
    }
    // ACP: after session/cancel, the client answers the turn's open permission requests with `cancelled`.
    const cancelled = cancelPending(proc);
    if (cancelled > 0 && proc.turn) safely(agentId, "cancel", () => setState(agentId, "working"));
    log("turn_cancel_sent", { agentId, permissionsCancelled: cancelled });
  };

  const stop = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    if (!proc) return;
    proc.ending ??= "stop";
    await terminate(proc);
    log("agent_stopped", { agentId });
  };

  const remove = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    if (proc) {
      proc.ending = "remove";
      await terminate(proc);
    }
    const seq = store.deleteAgent(agentId);
    summaries.delete(agentId);
    commandIds.delete(agentId);
    if (seq !== undefined) emit({ seq, agentId, type: "agent_removed" });
    log("agent_deleted", { agentId });
  };

  /** Ends every agent's process group; later calls fail. Agents it ends are recorded as stopped. */
  const shutdown = () => {
    shuttingDown ??= (async () => {
      const running = [...procs.values()];
      for (const proc of running) proc.ending ??= "stop";
      await Promise.all(running.map(terminate));
      log("shutdown", { agents: running.length });
    })();
    return shuttingDown;
  };

  const onCommitted = (listener: (event: Committed) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { start, send, answer, cancel, stop, delete: remove, shutdown, onCommitted };
};

export type Manager = ReturnType<typeof createManager>;
