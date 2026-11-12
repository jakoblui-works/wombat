import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { McpServer, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  AgentErrorCode,
  AnswerPermissionRequest,
  LogEntry,
  parseLogEntry,
  permissionTitle,
  PROPOSAL_ALERT,
  type AgentSummary,
  type Alert,
  type ErrorBody,
  type SendMessageRequest,
  type SessionUpdate,
} from "@wombat/shared/api";

import { MCP_SERVER_NAME, startAgentProcess, type AgentScope, type Harness } from "../harness/harness.ts";
import { defaultHarnesses, findHarness } from "../harness/registry.ts";
import { logToStderr, type Log } from "../log.ts";
import type { NewLogEntry, Store } from "../store/store.ts";
import { RepoError, resolveRepo } from "../workspace.ts";
import { connectAgent, type AcpAgent } from "./acp-client.ts";
import { readBranch } from "./branch.ts";
import { excerpt, keepForExcerpt } from "./excerpt.ts";
import { createScopes, DEFAULT_SLICE } from "./scope.ts";

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

/** A change committed to the store, told to listeners (the alert stream) once it can be read. */
type WithoutDbId<T> = T extends unknown ? Omit<T, "dbId"> : never;
export type Committed = WithoutDbId<Alert>;

export type ManagerOptions = {
  store: Store;
  /** Repo paths are relative to this folder, and must resolve inside it. */
  workspaceRoot: string;
  harnesses?: readonly Harness[];
  log?: Log;
  /** What each agent's environment is filtered from (see `agentEnv`). */
  env?: NodeJS.ProcessEnv;
  /** The systemd slice agents' scopes go in; everything in it is stopped at start-up and shutdown. */
  slice?: string;
  /** The instructions file's text for a new session, or undefined when there is none: then nothing is sent. */
  readInstructions: () => Promise<string | undefined>;
};

type PermissionKind = AnswerPermissionRequest["kind"];
type ErrorDetail = ErrorBody["error"];
type PendingPermission = AgentSummary["pendingPermissions"][number];

type Pending = Omit<PendingPermission, "requestId"> & {
  /** Option kind → the agent's optionId, for the kinds it offered. */
  offered: Map<PermissionKind, string>;
  /** The ACP session that asked; its answer is recorded under the same one. */
  sessionId: string;
  respond: (response: RequestPermissionResponse) => void;
};

/** One agent process, from spawn until it closed. */
type Proc = {
  agentId: string;
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
  /** False until the agent's summary is stored; updates that arrive before are held. */
  recorded: boolean;
  held: { sessionId: string; update: unknown }[];
  /** Why the service is ending the process: "stop" keeps the agent (stopped), "remove" writes nothing. */
  ending: "stop" | "remove" | undefined;
  turn: boolean;
  /** Open permission requests by requestId, oldest first; the summary's pendingPermissions mirror it. */
  pending: Map<string, Pending>;
  /** The latest title and kind each tool call of the current turn was stored with, by toolCallId. */
  toolCalls: Map<string, { title?: string; kind?: PendingPermission["kind"] }>;
  skipped: number;
};

/** The agent's latest message, as far as its summary's lastText needs it. */
type LastMessage = {
  messageId: string | null;
  /** What `keepForExcerpt` kept of the message's text. */
  kept: string;
  /** False once anything but a chunk of it came: the next chunk starts a new message. */
  open: boolean;
};

const START_TIMEOUT_MS = 60_000;
/** How long an agent gets to exit after SIGTERM before its process group is killed. */
const KILL_GRACE_MS = 2_000;
/** How long after an agent exits its stdio may stay open (still being read) before the service drops it. */
const CLOSE_GRACE_MS = 500;
const ACP_AUTH_REQUIRED = -32000;
/** The token map's key: a hash, so a lookup's timing says nothing about the token itself. */
const tokenKey = (token: string) => createHash("sha256").update(token).digest("base64url");

const now = () => new Date().toISOString();

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

/** Waits for `promise`, but no longer than `ms`: it goes on in the background. */
const settleWithin = async (promise: Promise<void>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
};

const withTimeout = <T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const notFound = (agentId: string) =>
  new AgentError(AgentErrorCode.enum.not_found, `There's no agent ${agentId}. List the agents to see which exist.`);

const notRunning = () =>
  new AgentError(
    AgentErrorCode.enum.not_running,
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
  slice = DEFAULT_SLICE,
  readInstructions,
}: ManagerOptions) => {
  const listeners = new Set<(event: Committed) => void>();
  const summaries = new Map(store.listAgents().map((agent) => [agent.id, agent]));
  const procs = new Map<string, Proc>();
  const lastMessages = new Map<string, LastMessage>();
  // commandId → seq of its user_message, per agent; loaded from the store on first use.
  const commandIds = new Map<string, Map<string, number>>();
  let shuttingDown: Promise<void> | undefined;
  const scopes = createScopes({ slice, env, log });
  // Token key → agentId for every agent with a live /mcp token. The tokens themselves are held nowhere: each one
  // only passes through its agent's session/new.
  const agentTokens = new Map<string, string>();
  let mcpUrl: string | undefined;

  const emit = (event: Committed) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        const subject = event.type === PROPOSAL_ALERT ? { proposalId: event.proposalId } : { agentId: event.agentId };
        log("listener_failed", { ...subject, seq: event.seq, type: event.type });
      }
    }
  };

  /**
   * Mints the agent's /mcp token (32 random bytes) and its `mcpServers` entry; none before the server told the
   * manager its URL, or once the process has ended.
   */
  const mcpServersFor = (proc: Proc): McpServer[] => {
    if (mcpUrl === undefined || shuttingDown || procs.get(proc.agentId) !== proc) return [];
    const token = randomBytes(32).toString("base64url");
    proc.tokenKey = tokenKey(token);
    agentTokens.set(proc.tokenKey, proc.agentId);
    return [{ type: "http", name: MCP_SERVER_NAME, url: mcpUrl, headers: [{ name: "Authorization", value: `Bearer ${token}` }] }];
  };

  const revokeToken = (proc: Proc) => {
    if (proc.tokenKey === undefined) return;
    agentTokens.delete(proc.tokenKey);
    proc.tokenKey = undefined;
  };

  const putSummary = (summary: AgentSummary, type: "agent_added" | "agent_changed") => {
    const seq = store.putAgent(summary);
    summaries.set(summary.id, summary);
    emit({ seq, agentId: summary.id, type });
  };

  const appendLog = (agentId: string, entries: NewLogEntry[]) => {
    const seqs = store.append(agentId, entries);
    const last = seqs.at(-1);
    if (last !== undefined) emit({ seq: last, agentId, type: "log" });
    return seqs;
  };

  /** The summary rows of the agent's open permission requests: the only source of `pendingPermissions`. */
  const pendingPermissions = (agentId: string): PendingPermission[] =>
    [...(procs.get(agentId)?.pending ?? [])].map(([requestId, { at, title, kind }]) => ({ requestId, at, title, kind }));

  /**
   * Writes the agent's state with its pendingPermissions derived anew and its latest message's lastText, so every
   * change to the open requests is followed by one of these.
   */
  const setState = (
    agentId: string,
    state: AgentSummary["state"],
    { error, lastUserAt }: { error?: ErrorDetail; lastUserAt?: string } = {},
  ) => {
    const current = summaries.get(agentId);
    if (!current) return;
    const next: AgentSummary = {
      ...current,
      state,
      lastActivityAt: now(),
      pendingPermissions: pendingPermissions(agentId),
    };
    delete next.error;
    if (error) next.error = error;
    if (lastUserAt !== undefined) next.lastUserAt = lastUserAt;
    const message = lastMessages.get(agentId);
    if (message) {
      const text = excerpt(message.kept);
      delete next.lastText;
      if (text !== "") next.lastText = text;
    }
    putSummary(next, "agent_changed");
    log("agent_state", { agentId, state });
  };

  /** Reads the branch of the agent's folder; undefined (and one log line) when that fails. */
  const branchOf = async (agentId: string, cwd: string) => {
    try {
      return await readBranch(cwd);
    } catch {
      log("branch_unreadable", { agentId });
      return undefined;
    }
  };

  /** Re-reads the agent's branch and writes it when it changed, unless the agent was removed meanwhile. */
  const refreshBranch = async (agentId: string, cwd: string) => {
    const branch = await branchOf(agentId, cwd);
    const current = summaries.get(agentId);
    if (!current || current.branch === branch) return;
    const next: AgentSummary = { ...current };
    delete next.branch;
    if (branch !== undefined) next.branch = branch;
    safely(agentId, "branch", () => putSummary(next, "agent_changed"));
  };

  /** Follows the agent's messages for lastText: chunks of one message join, anything else ends the message. */
  const trackMessage = (agentId: string, update: SessionUpdate) => {
    const last = lastMessages.get(agentId);
    if (update.sessionUpdate !== "agent_message_chunk") {
      if (last) last.open = false;
      return;
    }
    const messageId = update.messageId ?? null;
    const text = update.content.type === "text" ? update.content.text : "";
    if (last?.open && last.messageId === messageId) last.kept = keepForExcerpt(last.kept, text);
    else lastMessages.set(agentId, { messageId, kept: keepForExcerpt("", text), open: true });
  };

  /** Remembers a stored tool call's title and kind, for permission requests that name it by id only. */
  const trackToolCall = (proc: Proc, update: SessionUpdate) => {
    if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
    const known = proc.toolCalls.get(update.toolCallId) ?? {};
    if (typeof update.title === "string") known.title = update.title;
    if (typeof update.kind === "string") known.kind = update.kind;
    proc.toolCalls.set(update.toolCallId, known);
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
        AgentErrorCode.enum.not_running,
        "The agent service is shutting down and takes no more agent commands. Start the service again.",
      );
    }
  };

  const knownCommands = (agentId: string) => {
    let known = commandIds.get(agentId);
    if (!known) {
      known = new Map();
      for (const entry of store.readLog(agentId).entries) {
        if (entry.type === "user_message" && entry.commandId !== undefined) known.set(entry.commandId, entry.seq);
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
    let entry: LogEntry | undefined;
    try {
      entry = parseLogEntry({ type: "session_update", seq: 0, agentId, at: now(), sessionId, update });
    } catch {
      log("update_invalid", { agentId, kind });
      return;
    }
    if (entry?.type !== "session_update") {
      proc.skipped += 1;
      log("update_skipped", { agentId, kind, count: proc.skipped });
      return;
    }
    const parsed = entry.update;
    safely(agentId, "session_update", () => {
      appendLog(agentId, [{ type: "session_update", sessionId, update: parsed }]);
      trackMessage(agentId, parsed);
      trackToolCall(proc, parsed);
      if (parsed.sessionUpdate === "session_info_update" && typeof parsed.title === "string") {
        const current = summaries.get(agentId);
        if (current) putSummary({ ...current, title: parsed.title, lastActivityAt: now() }, "agent_changed");
      }
    });
  };

  const requestPermission = (proc: Proc, request: RequestPermissionRequest) => {
    const { agentId } = proc;
    const { sessionId } = request;
    const requestId = randomUUID();
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
    if (!proc.recorded || !parsed.success || parsed.data.type !== "permission_requested" || offered.size === 0) {
      log("permission_invalid", { agentId, requestId });
      return Promise.resolve<RequestPermissionResponse>({ outcome: { outcome: "cancelled" } });
    }
    const { toolCall, options, at } = parsed.data;
    const stored = proc.toolCalls.get(toolCall.toolCallId);
    const title = permissionTitle(toolCall.title, stored?.title);
    const kind = toolCall.kind ?? stored?.kind ?? "other";
    return new Promise<RequestPermissionResponse>((respond) => {
      proc.pending.set(requestId, { offered, sessionId, respond, at, title, kind });
      safely(agentId, "permission_requested", () => {
        appendLog(agentId, [{ type: "permission_requested", at, sessionId, requestId, toolCall, options }]);
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
        appendLog(agentId, [{ type: "turn_ended", stopReason }]);
        setState(agentId, "done");
      });
      log("turn_ended", { agentId, stopReason: safeName(stopReason) });
      await refreshBranch(agentId, proc.cwd);
    } catch (error) {
      proc.turn = false;
      cancelPending(proc);
      // The connection closed: the process ended, and its close handler records why.
      if (proc.acp.isClosed()) return;
      const code = rpcCode(error);
      safely(agentId, "turn_failed", () =>
        setState(agentId, "error", {
          error: {
            code: AgentErrorCode.enum.agent_failed,
            message:
              `The agent reported an error during the turn${code === undefined ? "" : ` (ACP error ${code})`}. ` +
              "Send the message again, or stop the agent and start a new one.",
          },
        }),
      );
      log("turn_failed", { agentId, code: code ?? -1 });
      await refreshBranch(agentId, proc.cwd);
    }
  };

  const spawnAgent = (agentId: string, harness: Harness, cwd: string, scope: AgentScope | undefined): Proc => {
    const child: ChildProcessWithoutNullStreams = startAgentProcess(harness.spawn(cwd, env), scope ? { scope } : {});
    const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
    const proc: Proc = {
      agentId,
      cwd,
      pid: child.pid,
      unit: scope?.unit,
      scopeKilled: undefined,
      exitedAt: undefined,
      acp: connectAgent(child, {
        update: (sessionId, update) => handleUpdate(proc, sessionId, update),
        permission: (request) => requestPermission(proc, request),
      }),
      tokenKey: undefined,
      closed,
      sessionId: "",
      recorded: false,
      held: [],
      ending: undefined,
      turn: false,
      pending: new Map(),
      toolCalls: new Map(),
      skipped: 0,
    };

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      revokeToken(proc);
      procs.delete(agentId);
      proc.acp.close();
      cancelPending(proc);
      if (proc.recorded && proc.ending === "stop") {
        safely(agentId, "stopped", () => setState(agentId, "stopped"));
      } else if (proc.recorded && proc.ending === undefined) {
        const how = code === null ? `was killed (${signal ?? "unknown signal"})` : `exited with code ${code}`;
        safely(agentId, "exited", () =>
          setState(agentId, "error", {
            error: {
              code: AgentErrorCode.enum.agent_failed,
              message: `The agent process ${how} unexpectedly. Start a new agent to continue; this one's history is kept.`,
            },
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
      proc.exitedAt = Date.now();
      // An ended agent's token works nowhere, even while its stdio is still being drained.
      revokeToken(proc);
      // Helpers the agent started (claude-agent-acp's native `claude`) share its group and must not outlive it.
      killGroup(child.pid, "SIGKILL");
      // The scope also holds helpers that left the group or session; collected once empty, so this ends it.
      if (proc.unit !== undefined) proc.scopeKilled = scopes.kill(agentId, proc.unit);
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
    // A user manager that doesn't answer must not hang a stop: the kill goes on in the background.
    if (proc.scopeKilled) {
      const left = (proc.exitedAt ?? Date.now()) + CLOSE_GRACE_MS - Date.now();
      await settleWithin(proc.scopeKilled, Math.max(0, left));
    }
  };

  const startFailure = (error: unknown, harness: Harness, proc: Proc) => {
    if (error instanceof AgentError) return error;
    const code = rpcCode(error);
    if (code === ACP_AUTH_REQUIRED) {
      return new AgentError(
        AgentErrorCode.enum.auth_required,
        `${harness.name} needs a login before it can start a session. Log in, then start the agent again.`,
        harness.loginHint,
      );
    }
    if (proc.acp.isClosed() && proc.unit !== undefined) {
      // systemd-run exits without running the agent when it can't create the scope; from here that looks
      // like an agent that ended at once, so both are named.
      return new AgentError(
        AgentErrorCode.enum.agent_failed,
        `The agent process ended before its session started: either its systemd scope (${proc.unit}) couldn't be ` +
          `created, or ${harness.name} failed. Check that \`systemctl --user\` works and that ${harness.name} is ` +
          "installed and runs, then try again.",
      );
    }
    const what = proc.acp.isClosed()
      ? "The agent process ended before its session started"
      : `The agent refused to start a session${code === undefined ? "" : ` (ACP error ${code})`}`;
    return new AgentError(AgentErrorCode.enum.agent_failed, `${what}. Check that ${harness.name} is installed and runs, then try again.`);
  };

  // Agents stored by an earlier run have no process any more, so no open requests either.
  let marked = 0;
  for (const agent of [...summaries.values()]) {
    const live = agent.state === "working" || agent.state === "waiting" || agent.state === "done";
    if (live || agent.pendingPermissions.length > 0) {
      const state = live ? "stopped" : agent.state;
      putSummary({ ...agent, state, pendingPermissions: pendingPermissions(agent.id) }, "agent_changed");
    }
    if (live) {
      log("agent_state", { agentId: agent.id, state: "stopped" });
      marked += 1;
    }
  }
  log("agents_loaded", { count: summaries.size, markedStopped: marked });

  const start = async (harnessId: string, repo: string): Promise<AgentSummary> => {
    assertOpen();
    const harness = findHarness(harnessId, harnesses);
    if (!harness) {
      throw new AgentError(AgentErrorCode.enum.unknown_harness, `There's no harness "${harnessId}". List the harnesses to see which exist.`);
    }
    let cwd: string;
    try {
      cwd = resolveRepo(workspaceRoot, repo);
    } catch (error) {
      if (error instanceof RepoError) throw new AgentError(error.code, error.message);
      throw error;
    }

    const agentId = randomUUID();
    const scope = await scopes.scopeFor(agentId);
    // Shutdown may have begun while the scopes were being set up.
    assertOpen();
    const proc = spawnAgent(agentId, harness, cwd, scope);
    procs.set(agentId, proc);
    log("agent_starting", { agentId, harness: harness.id });
    const tooSlow = () =>
      new AgentError(
        AgentErrorCode.enum.agent_failed,
        `${harness.name} didn't start a session within ${START_TIMEOUT_MS / 1000} s. Check that it runs, then try again.`,
      );
    try {
      const deadline = Date.now() + START_TIMEOUT_MS;
      const initialized = await withTimeout(proc.acp.initialize(), START_TIMEOUT_MS, tooSlow);
      // D26: the instructions as they are now; a running agent keeps the ones it started with.
      const instructions = harness.sessionParams === undefined ? undefined : await readInstructions();
      const session = {
        mcpServers: mcpServersFor(proc),
        ...(harness.sessionMeta === undefined ? {} : { _meta: harness.sessionMeta }),
        ...(instructions === undefined || harness.sessionParams === undefined ? {} : { params: harness.sessionParams(instructions) }),
      };
      const sessionId = await withTimeout(proc.acp.newSession(cwd, session), Math.max(0, deadline - Date.now()), tooSlow);
      const branch = await branchOf(agentId, cwd);
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
        ...(branch === undefined ? {} : { branch }),
        pendingPermissions: pendingPermissions(agentId),
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
      throw new AgentError(AgentErrorCode.enum.busy, "The agent is still working on the last message. Wait for it to finish, or cancel it.");
    }
    const at = now();
    const [seq = 0] = appendLog(agentId, [
      { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) },
    ]);
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    const last = lastMessages.get(agentId);
    if (last) last.open = false;
    proc.toolCalls.clear();
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(agentId, "working", { lastUserAt: at }));
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
    appendLog(agentId, [{ type: "permission_answered", at, sessionId: pending.sessionId, requestId, kind }]);
    proc.pending.delete(requestId);
    const state = proc.pending.size === 0 ? "working" : "waiting";
    safely(agentId, "permission_answered", () => setState(agentId, state, { lastUserAt: at }));
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
    const state = proc.turn ? "working" : summaries.get(agentId)?.state;
    if (cancelled > 0 && state) safely(agentId, "cancel", () => setState(agentId, state));
    log("turn_cancel_sent", { agentId, permissionsCancelled: cancelled });
  };

  const stop = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    if (!proc) return;
    proc.ending ??= "stop";
    revokeToken(proc);
    await terminate(proc);
    log("agent_stopped", { agentId });
  };

  const remove = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    const proc = procs.get(agentId);
    if (proc) {
      proc.ending = "remove";
      revokeToken(proc);
      await terminate(proc);
    }
    const seq = store.deleteAgent(agentId);
    summaries.delete(agentId);
    commandIds.delete(agentId);
    lastMessages.delete(agentId);
    if (seq !== undefined) emit({ seq, agentId, type: "agent_removed" });
    log("agent_deleted", { agentId });
  };

  /** Ends every agent's process group and scope, then the slice; later calls fail. Agents it ends are recorded as stopped. */
  const shutdown = () => {
    shuttingDown ??= (async () => {
      const running = [...procs.values()];
      for (const proc of running) {
        proc.ending ??= "stop";
        revokeToken(proc);
      }
      await Promise.all(running.map(terminate));
      await scopes.stopSlice();
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

  /** Where agents reach the service's /mcp endpoint; agents started from now on get a token and this URL. */
  const setMcpUrl = (url: string) => {
    mcpUrl = url;
  };

  /** The agent a /mcp bearer token belongs to, while that agent's process runs; undefined for any other string. */
  const agentForToken = (token: string): string | undefined => agentTokens.get(tokenKey(token));

  /** Tells the listeners about a committed proposal change (stored, approved, rejected, conflict). */
  const proposalCommitted = (proposalId: string, seq: number) => emit({ seq, type: PROPOSAL_ALERT, proposalId });

  return {
    start,
    send,
    answer,
    cancel,
    stop,
    delete: remove,
    shutdown,
    onCommitted,
    setMcpUrl,
    agentForToken,
    proposalCommitted,
  };
};

export type Manager = ReturnType<typeof createManager>;
