import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { McpServer, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  AgentErrorCode,
  AnswerPermissionRequest,
  ConfigOption,
  LogEntry,
  parseLogEntry,
  PROPOSAL_ALERT,
  SERVICE_STOP_REASON,
  type AgentSummary,
  type Alert,
  type ErrorBody,
  type SendMessageRequest,
  type ServerErrorCode,
  configToRestore,
  selectValues,
  type ContextBreakdown,
} from "@wombat/shared/api";
import {
  activityOf,
  commandsOf,
  configOf,
  emptyFold,
  foldEntry,
  foldLog,
  lastMainMessage,
  permissionOf,
  sameActivity,
  UNKNOWN_PERMISSION,
  type FoldState,
} from "@wombat/shared/log-fold";
import { z } from "zod";

import { MCP_SERVER_NAME, startAgentProcess, type AgentScope, type CacheState, type Harness } from "../harness/harness.ts";
import { canResume, defaultHarnesses, findHarness } from "../harness/registry.ts";
import { logToStderr, type Log } from "../log.ts";
import type { NewLogEntry, Store } from "../store/store.ts";
import { RepoError, resolveRepo } from "../workspace.ts";
import { connectAgent, type AcpAgent } from "./acp-client.ts";
import { readBranch } from "./branch.ts";
import { contextGate } from "./context-gate.ts";
import { excerpt, keepForExcerpt } from "./excerpt.ts";
import { createScopes, DEFAULT_SLICE } from "./scope.ts";

/** A manager call's error codes: the agent ones, and `invalid_request` for a config value the option doesn't take. */
export type AgentErrorCodes = AgentErrorCode | typeof ServerErrorCode.enum.invalid_request;

/** A failed manager call; the server maps `code` to its HTTP status. */
export class AgentError extends Error {
  readonly code: AgentErrorCodes;
  readonly hint: string | undefined;

  constructor(code: AgentErrorCodes, message: string, hint?: string) {
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
type StateDetails = { error?: ErrorDetail; lastUserAt?: string };
type PendingPermission = AgentSummary["pendingPermissions"][number];

type Pending = Pick<PendingPermission, "at"> & {
  /** Option kind → the agent's optionId, for the kinds it offered. */
  offered: Map<PermissionKind, string>;
  /** The ACP session that asked; its answer is recorded under the same one. */
  sessionId: string;
  respond: (response: RequestPermissionResponse) => void;
};

/** A harness waiting for one of the agent's extension notifications (see `ContextAgent.nextExt`). */
type ExtWaiter = { method: string; match: (params: unknown) => boolean; resolve: (params: unknown) => void; reject: (error: Error) => void };

/** One agent process, from spawn until it closed. */
type Proc = {
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
  /** False until the agent's summary is stored; updates that arrive before are held. */
  recorded: boolean;
  held: { sessionId: string; update: unknown }[];
  /** Why the service is ending the process: "stop" keeps the agent (stopped), "remove" writes nothing. */
  ending: "stop" | "remove" | undefined;
  /**
   * True from send until the turn's `turn_ended` is written; once the connection closes or the service is ending the
   * process, only the close handler clears it.
   */
  turn: boolean;
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
  /**
   * True while a hidden turn (`contextBreakdown`) runs: the agent's updates are dropped, and messages and config
   * changes answer `busy`. Set and cleared only by `hiddenReport`.
   */
  hidden: boolean;
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

const START_TIMEOUT_MS = 60_000;
/** How long a config set the user asked for waits for the agent; under the desktop's request timeout, so its answer arrives. */
const CONFIG_SET_TIMEOUT_MS = 30_000;
/** Why a message or config change is refused while the agent reports its context. */
const STILL_WORKING = "The agent is still working on the last message. Wait for it to finish, or cancel it.";
const HIDDEN_BUSY =
  "The agent is reporting its context. Try again in a moment; if it stays busy, stop the agent, then try again: it keeps its conversation.";
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

const ConfigOptions = z.array(ConfigOption);

/** A JSON-RPC error's message: the agent's own text, so it goes back to the app and never to a log line. */
const rpcMessage = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : undefined;

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

/** Throws `invalid_request` unless `value` is one the option takes: a boolean for a boolean, one of a select's values for a select. */
const checkConfigValue = (option: ConfigOption, value: string | boolean) => {
  const fail = (message: string) => new AgentError("invalid_request", `The config option "${option.id}" ${message}`);
  if (option.type === "boolean") {
    if (typeof value !== "boolean") throw fail("takes true or false. Send one it takes.");
    return;
  }
  if (option.type !== "select" || !("options" in option)) {
    throw fail("is of a type the service can't set. Change it in the agent itself, or leave it as it is.");
  }
  const values = selectValues(option).map((entry) => entry.value);
  if (values.length === 0) throw fail("offers no values to pick from. Leave it as it is, or check that the agent is up to date.");
  if (typeof value !== "string" || !values.includes(value)) throw fail(`takes one of: ${values.join(", ")}. Send one it takes.`);
};

/** Why a config set failed when the agent never answered it. */
const configUnanswered = (configId: string, timeoutMs: number) =>
  new AgentError(
    AgentErrorCode.enum.agent_error,
    `The agent didn't answer the change to "${configId}" within ${timeoutMs / 1000} s, so it may not have taken it. ` +
      "Try again; if it still doesn't answer, stop the agent and send a message to start it again (it keeps its conversation).",
  );

export const notFound = (agentId: string) =>
  new AgentError(AgentErrorCode.enum.not_found, `There's no agent ${agentId}. List the agents to see which exist.`);

const busy = (message: string) => new AgentError(AgentErrorCode.enum.busy, message);

const sameCache = (a: CacheState | null, b: CacheState | null) =>
  a === b || (a !== null && b !== null && a.ttlSeconds === b.ttlSeconds && a.lastRequestAt === b.lastRequestAt);

/** Why a call found no process to act on; `resumable` (its harness's) says whether a message starts it again. */
const notRunning = (resumable = false) =>
  new AgentError(
    AgentErrorCode.enum.not_running,
    `The agent isn't running (it was stopped or its process ended). ${
      resumable ? "Send a message to start it again" : "Start a new agent to continue"
    }; its history is kept.`,
  );

/** Why an agent without a process stays so: its harness can't resume it, so its chat is closed. */
const notResumable = () =>
  new AgentError(AgentErrorCode.enum.not_running, "This agent can't be started again. Start a new agent to continue.");

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
  // commandId → seq of its user_message, per agent; loaded from the store on first use.
  const commandIds = new Map<string, Map<string, number>>();
  let shuttingDown: Promise<void> | undefined;
  const scopes = createScopes({ slice, env, log });
  // Token key → agentId for every agent with a live /mcp token. The tokens themselves are held nowhere: each one
  // only passes through its agent's session/new.
  const agentTokens = new Map<string, string>();
  let mcpUrl: string | undefined;
  // The one resume under way per agent (`ensureRunning`): every caller waiting for the agent's process shares it.
  const resuming = new Map<string, Promise<Proc>>();
  // Agents whose message is stored while their process is being resumed: the turn runs once it is (`resumeTurn`).
  const pendingTurns = new Set<string>();
  // Agents whose waiting message was cancelled before its resume finished: the turn ends without being sent.
  const cancelledTurns = new Set<string>();

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

  /**
   * Stores the summary with `hasProcess` derived from the live processes, its only source. `cache` stays on the
   * in-memory summary and is never stored.
   */
  const putSummary = (fields: Omit<AgentSummary, "hasProcess">, type: "agent_added" | "agent_changed") => {
    const summary: AgentSummary = { ...fields, hasProcess: procs.has(fields.id) };
    const stored = { ...summary };
    delete stored.cache;
    const seq = store.putAgent(stored);
    summaries.set(summary.id, summary);
    emit({ seq, agentId: summary.id, type });
    return summary;
  };

  /**
   * Stores the entries and tells listeners; every entry of the agent's log is written through here. Only for an agent
   * without a process (a message that resumes it, the end of a turn whose resume failed); otherwise `appendLog`.
   */
  const storeEntries = (agentId: string, entries: NewLogEntry[]) => {
    const stored = entries.map((entry) => ({ ...entry, at: entry.at ?? now() }));
    const seqs = store.append(agentId, stored);
    const last = seqs.at(-1);
    if (last !== undefined) emit({ seq: last, agentId, type: "log" });
    return { stored, seqs };
  };

  /** Stores the entries (`storeEntries`) and folds each one as stored. */
  const appendLog = (proc: Proc, entries: NewLogEntry[]) => {
    const { agentId } = proc;
    if (!proc.fold) throw new Error(`Can't log for agent ${agentId} before its session started.`);
    const { stored, seqs } = storeEntries(agentId, entries);
    let fold = proc.fold;
    for (const [index, entry] of stored.entries()) {
      if (entry.type === "user_message") fold = emptyFold(proc.sessionId);
      foldEntry(fold, { ...entry, seq: seqs[index] ?? 0, agentId }, { keepText: keepForExcerpt });
    }
    proc.fold = fold;
    proc.config = configOf(fold) ?? proc.config;
    proc.commands = commandsOf(fold) ?? proc.commands;
    return seqs;
  };

  /**
   * The summary rows of the agent's open permission requests: the only source of `pendingPermissions`. Title and kind
   * are the fold's; a request whose entry couldn't be stored has none to read and gets `UNKNOWN_PERMISSION`.
   */
  const pendingPermissions = (proc: Proc | undefined): PendingPermission[] =>
    [...(proc?.pending ?? [])].map(([requestId, { at }]) => {
      const { title, kind } = (proc?.fold && permissionOf(proc.fold, requestId)) ?? UNKNOWN_PERMISSION;
      return { requestId, at, title, kind };
    });

  /** The summary's activity: what the turn's fold says while the agent works, else none. */
  const activityNow = (proc: Proc | undefined, state: AgentSummary["state"]) => (state === "working" && proc?.fold ? activityOf(proc.fold) : null);

  /**
   * `current` with what the turn's fold says now: the activity for `state`, and lastText. With no main-session message
   * in the fold (a new turn), the stored lastText stays.
   */
  const fromFold = (proc: Proc | undefined, current: AgentSummary, state: AgentSummary["state"]): AgentSummary => {
    const next: AgentSummary = { ...current, activity: activityNow(proc, state) };
    const message = proc?.fold && lastMainMessage(proc.fold);
    if (message !== undefined) {
      const text = excerpt(message);
      delete next.lastText;
      if (text !== "") next.lastText = text;
    }
    return next;
  };

  /**
   * After a stored update: writes the summary when its activity changed (by `sameActivity`), taking the fold's lastText
   * along. A change to lastText alone writes nothing; it is current at least at each turn's end.
   */
  const refreshFromFold = (proc: Proc) => {
    const current = summaries.get(proc.agentId);
    if (!current) return;
    const next = fromFold(proc, current, current.state);
    if (sameActivity(next.activity ?? null, current.activity ?? null)) return;
    putSummary(next, "agent_changed");
  };

  /**
   * Writes the agent's state with its pendingPermissions derived anew and its activity and lastText from its fold
   * (`fromFold`), so every change to the open requests is followed by one of these. `agentState` is for an agent
   * without a process (no requests, no activity).
   */
  const setState = (proc: Proc, state: AgentSummary["state"], details: StateDetails = {}) => {
    agentState(proc.agentId, proc, state, details);
  };

  const agentState = (
    agentId: string,
    proc: Proc | undefined,
    state: AgentSummary["state"],
    { error, lastUserAt }: StateDetails = {},
  ) => {
    const current = summaries.get(agentId);
    if (!current) return;
    const next: AgentSummary = {
      ...fromFold(proc, current, state),
      state,
      lastActivityAt: now(),
      pendingPermissions: pendingPermissions(proc),
    };
    delete next.error;
    if (error) next.error = error;
    if (lastUserAt !== undefined) next.lastUserAt = lastUserAt;
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
    if (proc.hidden) {
      log("update_hidden", { agentId, kind });
      return;
    }
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
      appendLog(proc, [{ type: "session_update", sessionId, update: parsed }]);
      if (parsed.sessionUpdate === "session_info_update" && typeof parsed.title === "string") {
        const current = summaries.get(agentId);
        if (current) putSummary({ ...current, title: parsed.title, lastActivityAt: now() }, "agent_changed");
      }
      refreshFromFold(proc);
    });
  };

  /**
   * An extension notification: the harness reads it (a cache state it reports is kept on the proc and, when it
   * changed, written to the in-memory summary), then any harness waiting for it gets its params.
   */
  const handleExt = (proc: Proc, method: string, params: unknown) => {
    const { agentId } = proc;
    let result: ReturnType<NonNullable<Harness["extNotification"]>>;
    try {
      result = proc.harness.extNotification?.(method, params, proc.cache);
    } catch {
      log("ext_invalid", { agentId });
    }
    const cache = result?.cache;
    if (cache !== undefined && !sameCache(cache, proc.cache)) {
      proc.cache = cache;
      const current = summaries.get(agentId);
      if (proc.recorded && current) safely(agentId, "cache", () => putSummary({ ...current, cache }, "agent_changed"));
    }
    for (const waiter of [...proc.extWaiters]) {
      let matched = false;
      try {
        matched = waiter.method === method && waiter.match(params);
      } catch {
        // A match that throws is no match.
      }
      if (!matched) continue;
      proc.extWaiters.delete(waiter);
      waiter.resolve(params);
    }
  };

  /** `ContextAgent.nextExt` for the agent: the params of its next notification `method` that `match` accepts. */
  const nextExt = (proc: Proc, method: string, match: (params: unknown) => boolean, timeoutMs: number) =>
    new Promise<unknown>((resolve, reject) => {
      const waiter: ExtWaiter = {
        method,
        match,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
        reject: (error) => {
          clearTimeout(timer);
          proc.extWaiters.delete(waiter);
          reject(error);
        },
      };
      const timer = setTimeout(
        () => waiter.reject(new Error(`The agent sent no report within ${timeoutMs / 1000} s.`)),
        timeoutMs,
      );
      proc.extWaiters.add(waiter);
    });

  /** Stores the agent's main-session options as a config_option_update; false when they don't parse. */
  const appendConfig = (proc: Proc, options: unknown[]) => {
    const parsed = ConfigOptions.safeParse(options);
    if (!parsed.success) {
      log("config_invalid", { agentId: proc.agentId });
      return false;
    }
    appendLog(proc, [{ type: "session_update", sessionId: proc.sessionId, update: { sessionUpdate: "config_option_update", configOptions: parsed.data } }]);
    return true;
  };

  const requestPermission = (proc: Proc, request: RequestPermissionRequest) => {
    const { agentId } = proc;
    const { sessionId } = request;
    const requestId = randomUUID();
    // A hidden turn leaves no trace, and nobody could answer: the agent gets `cancelled`.
    if (proc.hidden) {
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
    if (!proc.recorded || !parsed.success || parsed.data.type !== "permission_requested" || offered.size === 0) {
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

  const runTurn = async (proc: Proc, text: string) => {
    const { agentId } = proc;
    try {
      const { stopReason } = await proc.acp.prompt(proc.sessionId, text);
      proc.turn = false;
      cancelPending(proc);
      safely(agentId, "turn_ended", () => {
        appendLog(proc, [{ type: "turn_ended", stopReason }]);
        setState(proc, "done");
      });
      log("turn_ended", { agentId, stopReason: safeName(stopReason) });
      await refreshBranch(agentId, proc.cwd);
    } catch (error) {
      cancelPending(proc);
      // The connection closed, or the service is ending the process (whose answer may beat the close): the close
      // handler records why and ends the turn, so the turn stays open for it to see.
      if (proc.acp.isClosed() || proc.ending) return;
      proc.turn = false;
      const code = rpcCode(error);
      safely(agentId, "turn_failed", () => {
        appendLog(proc, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.error }]);
        setState(proc, "error", {
          error: {
            code: AgentErrorCode.enum.agent_failed,
            message:
              `The agent reported an error during the turn${code === undefined ? "" : ` (ACP error ${code})`}. ` +
              "Send the message again, or stop the agent and start a new one.",
          },
        });
      });
      log("turn_failed", { agentId, code: code ?? -1 });
      await refreshBranch(agentId, proc.cwd);
    }
  };

  const spawnAgent = (agentId: string, harness: Harness, cwd: string, scope: AgentScope | undefined): Proc => {
    const spec = harness.spawn(cwd, env);
    const child: ChildProcessWithoutNullStreams = startAgentProcess(spec, scope ? { scope } : {});
    const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
    const proc: Proc = {
      agentId,
      harness,
      home: spec.env.HOME,
      cwd,
      pid: child.pid,
      unit: scope?.unit,
      scopeKilled: undefined,
      exitedAt: undefined,
      acp: connectAgent(child, {
        update: (sessionId, update) => handleUpdate(proc, sessionId, update),
        permission: (request) => requestPermission(proc, request),
        ext: (method, params) => handleExt(proc, method, params),
      }),
      tokenKey: undefined,
      closed,
      sessionId: "",
      recorded: false,
      held: [],
      ending: undefined,
      turn: false,
      pending: new Map(),
      fold: undefined,
      config: undefined,
      commands: undefined,
      skipped: 0,
      hidden: false,
      contextReport: undefined,
      setting: Promise.resolve(),
      cache: null,
      extWaiters: new Set(),
    };

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      revokeToken(proc);
      // A resume may already have put a new process in its place.
      if (procs.get(agentId) === proc) procs.delete(agentId);
      proc.acp.close();
      cancelPending(proc);
      for (const waiter of [...proc.extWaiters]) waiter.reject(new Error("The agent's process ended."));
      // A turn the process ended under gets its end in the log too; a removed agent has no log left.
      if (proc.recorded && proc.turn && proc.ending !== "remove") {
        proc.turn = false;
        safely(agentId, "turn_stopped", () => appendLog(proc, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }]));
      }
      if (proc.recorded && proc.ending === "stop") {
        safely(agentId, "stopped", () => setState(proc, "stopped"));
      } else if (proc.recorded && proc.ending === undefined) {
        const how = code === null ? `was killed (${signal ?? "unknown signal"})` : `exited with code ${code}`;
        safely(agentId, "exited", () =>
          setState(proc, "error", {
            error: {
              code: AgentErrorCode.enum.agent_failed,
              message:
                `The agent process ${how} unexpectedly. ` +
                (canResume(proc.harness)
                  ? "Send a message to start it again; its history is kept."
                  : "Start a new agent to continue; this one's history is kept."),
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

  /**
   * What a session starts or resumes with: the harness's `_meta`, the instructions as they are now (a
   * running agent keeps the ones it started with) and the process's own /mcp token.
   */
  const sessionExtra = async (proc: Proc) => {
    const { harness } = proc;
    const instructions = harness.sessionParams === undefined ? undefined : await readInstructions();
    return {
      mcpServers: mcpServersFor(proc),
      ...(harness.sessionMeta === undefined ? {} : { _meta: harness.sessionMeta }),
      ...(instructions === undefined || harness.sessionParams === undefined ? {} : { params: harness.sessionParams(instructions) }),
    };
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

  /** Sets one config option, failing with `configUnanswered` when the agent doesn't answer within `timeoutMs`. */
  const setConfigWithin = (proc: Proc, configId: string, value: string | boolean, timeoutMs: number) =>
    withTimeout(proc.acp.setConfigOption(proc.sessionId, configId, value), timeoutMs, () => configUnanswered(configId, timeoutMs));

  // Agents stored by an earlier run have no process any more, so no open requests either; an error agent may still
  // be stored as having one (a failed turn) by a service that died.
  let marked = 0;
  for (const agent of [...summaries.values()]) {
    const live = agent.state === "working" || agent.state === "waiting" || agent.state === "done";
    if (live || agent.pendingPermissions.length > 0 || agent.hasProcess) {
      const state = live ? "stopped" : agent.state;
      putSummary({ ...agent, state, pendingPermissions: pendingPermissions(procs.get(agent.id)), activity: null }, "agent_changed");
    }
    if (live) {
      log("agent_state", { agentId: agent.id, state: "stopped" });
      marked += 1;
    }
  }
  log("agents_loaded", { count: summaries.size, markedStopped: marked });

  /** The agent's folder for `repo`, which must resolve inside the workspace. */
  const folderOf = (repo: string) => {
    try {
      return resolveRepo(workspaceRoot, repo);
    } catch (error) {
      if (error instanceof RepoError) throw new AgentError(error.code, error.message);
      throw error;
    }
  };

  /** Whether the agent's harness can start it again in its stored session; otherwise its chat is closed. */
  const canResumeAgent = (summary: AgentSummary) => {
    const harness = findHarness(summary.harness, harnesses);
    return harness !== undefined && canResume(harness);
  };

  /**
   * The agent's process when it can take a message or setting now: recorded, not ending, not being resumed, and no
   * message waiting for a resume to run.
   */
  const liveProc = (agentId: string) => {
    const proc = procs.get(agentId);
    return proc?.recorded && !proc.ending && !resuming.has(agentId) && !pendingTurns.has(agentId) ? proc : undefined;
  };

  /**
   * Spawns a process for a stored agent and takes up its session with ACP `session/resume` (`ensureRunning`'s one
   * attempt): the fold and config come from the stored log, the settings the resume answered at their defaults are set
   * again (`configToRestore`), and the agent's state is `done` unless a message waits for it. A failure ends the
   * process before anything is recorded of it, so the stored agent and its log stay as they were.
   */
  const resume = async (summary: AgentSummary, harness: Harness): Promise<Proc> => {
    const { id: agentId, sessionId } = summary;
    // A process still ending (a stop just asked for) writes its end first; a delete meanwhile ends the attempt.
    await procs.get(agentId)?.closed;
    if (!summaries.has(agentId)) {
      log("agent_resume_failed", { agentId, harness: harness.id, code: AgentErrorCode.enum.not_found });
      throw notFound(agentId);
    }
    const cwd = folderOf(summary.repo);
    const scope = await scopes.scopeFor(agentId);
    assertOpen();
    const proc = spawnAgent(agentId, harness, cwd, scope);
    procs.set(agentId, proc);
    log("agent_resuming", { agentId, harness: harness.id });
    const tooSlow = () =>
      new AgentError(
        AgentErrorCode.enum.agent_failed,
        `${harness.name} didn't take up this chat's session again within ${START_TIMEOUT_MS / 1000} s. Send the message again to retry.`,
      );
    try {
      const deadline = Date.now() + START_TIMEOUT_MS;
      const initialized = await withTimeout(proc.acp.initialize(), START_TIMEOUT_MS, tooSlow);
      if (!initialized.agentCapabilities?.sessionCapabilities?.resume) {
        throw new AgentError(
          AgentErrorCode.enum.agent_failed,
          `This version of ${harness.name} can't take up a stored session, so this chat can't go on. Update it and send the message again, or start a new agent; this one's history is kept.`,
        );
      }
      const session = await sessionExtra(proc);
      const { configOptions } = await withTimeout(proc.acp.resumeSession(sessionId, cwd, session), Math.max(0, deadline - Date.now()), tooSlow);
      if (!summaries.has(agentId)) throw notFound(agentId);
      if (shuttingDown || proc.ending || procs.get(agentId) !== proc) throw notRunning(true);
      proc.sessionId = sessionId;
      proc.fold = foldLog(store.readLog(agentId).entries, sessionId);
      proc.config = configOf(proc.fold);
      proc.commands = commandsOf(proc.fold);
      const stored = proc.config;
      proc.recorded = true;
      if (configOptions.length > 0) {
        safely(agentId, "config_option_update", () => {
          appendConfig(proc, configOptions);
        });
      }
      for (const { sessionId: from, update } of proc.held.splice(0)) handleUpdate(proc, from, update);
      const returned = ConfigOptions.safeParse(configOptions);
      for (const { id: configId, value } of returned.success ? configToRestore(stored, returned.data) : []) {
        try {
          const options = await setConfigWithin(proc, configId, value, START_TIMEOUT_MS);
          safely(agentId, "config_option_update", () => {
            appendConfig(proc, options);
          });
        } catch (error) {
          // An agent that leaves one set unanswered would leave the rest so too: the resume goes on without them.
          if (error instanceof AgentError) {
            log("config_restore_unanswered", { agentId, configId: safeName(configId) });
            break;
          }
          log("config_restore_refused", { agentId, configId: safeName(configId), code: rpcCode(error) ?? -1 });
        }
      }
      // A stop or delete during the restore: the close handler writes the agent's state, not this.
      const running = !proc.ending && procs.get(agentId) === proc;
      if (running && !pendingTurns.has(agentId)) safely(agentId, "resumed", () => setState(proc, "done"));
      log("agent_resumed", { agentId, harness: harness.id });
      return proc;
    } catch (error) {
      const failure = error instanceof AgentError || rpcCode(error) === ACP_AUTH_REQUIRED || proc.acp.isClosed() ? startFailure(error, harness, proc) : refusedResume(error, harness);
      // Nothing was recorded, so the close handler writes nothing.
      proc.ending ??= "remove";
      await terminate(proc);
      // The summary was written while the attempt's process ran (a message stored meanwhile): it has none now.
      const current = summaries.get(agentId);
      if (current?.hasProcess && !procs.has(agentId)) safely(agentId, "resume_failed", () => putSummary(current, "agent_changed"));
      log("agent_resume_failed", { agentId, harness: harness.id, code: failure.code });
      throw failure;
    }
  };

  /** The agent's refusal of `session/resume`: the remedy is to try again, then a new agent. */
  const refusedResume = (error: unknown, harness: Harness) => {
    const code = rpcCode(error);
    return new AgentError(
      AgentErrorCode.enum.agent_failed,
      `${harness.name} couldn't take up this chat's session again${code === undefined ? "" : ` (ACP error ${code})`}. ` +
        "Send the message again to retry; if it keeps failing, start a new agent (this one's history is kept).",
    );
  };

  /**
   * The agent's process, ready for a message or setting: the live one, or one spawned and resumed in the stored session
   * (`resume`); every caller meanwhile shares the one attempt. The only way a process is started for an existing
   * agent. `not_found` for an unknown agent, `not_running` when its harness can't resume, and the attempt's
   * error when it fails: never a fresh session under the old chat, where Claude would silently forget the conversation.
   */
  const ensureRunning = async (agentId: string): Promise<Proc> => {
    assertOpen();
    const summary = summaries.get(agentId);
    if (!summary) throw notFound(agentId);
    const pending = resuming.get(agentId);
    if (pending) return pending;
    const live = liveProc(agentId);
    if (live) return live;
    const harness = findHarness(summary.harness, harnesses);
    if (harness === undefined || !canResume(harness)) throw notResumable();
    const attempt = resume(summary, harness).finally(() => resuming.delete(agentId));
    resuming.set(agentId, attempt);
    return attempt;
  };

  /**
   * The background half of a message to an agent without a process: resumes it, then runs the stored message's turn.
   * A failed resume ends the turn as failed and leaves the agent in `error` with the attempt's message; one that
   * a stop or shutdown ended leaves it stopped.
   */
  const resumeTurn = async (agentId: string, text: string) => {
    let proc: Proc | undefined;
    let failure: unknown;
    try {
      proc = await ensureRunning(agentId);
    } catch (error) {
      failure = error;
    }
    pendingTurns.delete(agentId);
    const cancelled = cancelledTurns.delete(agentId);
    if (proc !== undefined) {
      const resumed = proc;
      resumed.turn = true;
      // Ending already: its close handler ends the turn.
      if (resumed.ending && procs.get(agentId) === resumed) return;
      if (procs.get(agentId) !== resumed) {
        // Ended already: its close handler wrote the agent's state, but saw no turn.
        resumed.turn = false;
        if (summaries.has(agentId)) safely(agentId, "turn_stopped", () => storeEntries(agentId, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }]));
        return;
      }
      if (cancelled) {
        // Cancelled while the agent was starting: the message never reaches it.
        resumed.turn = false;
        safely(agentId, "turn_cancelled", () => {
          appendLog(resumed, [{ type: "turn_ended", stopReason: "cancelled" }]);
          setState(resumed, "done");
        });
        log("turn_ended", { agentId, stopReason: "cancelled" });
        return;
      }
      safely(agentId, "turn_started", () => setState(resumed, "working"));
      await runTurn(resumed, text);
      return;
    }
    if (!summaries.has(agentId)) return;
    const stopped = failure instanceof AgentError && failure.code === AgentErrorCode.enum.not_running;
    const message = failure instanceof AgentError ? failure.message : "The agent couldn't be started again. Send the message again to retry.";
    safely(agentId, "turn_failed", () => {
      storeEntries(agentId, [{ type: "turn_ended", stopReason: stopped ? SERVICE_STOP_REASON.stopped : SERVICE_STOP_REASON.error }]);
      if (stopped) agentState(agentId, undefined, "stopped");
      else agentState(agentId, undefined, "error", { error: { code: AgentErrorCode.enum.agent_failed, message } });
    });
    log("turn_failed", { agentId, resumeError: failure instanceof AgentError ? failure.code : "unknown" });
  };

  const start = async (harnessId: string, repo: string): Promise<AgentSummary> => {
    assertOpen();
    const harness = findHarness(harnessId, harnesses);
    if (!harness) {
      throw new AgentError(AgentErrorCode.enum.unknown_harness, `There's no harness "${harnessId}". List the harnesses to see which exist.`);
    }
    const cwd = folderOf(repo);
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
      const session = await sessionExtra(proc);
      const { sessionId, configOptions } = await withTimeout(proc.acp.newSession(cwd, session), Math.max(0, deadline - Date.now()), tooSlow);
      const branch = await branchOf(agentId, cwd);
      // procs no longer holding it means the process ended before its summary could be stored.
      if (shuttingDown || proc.ending || procs.get(agentId) !== proc) throw notRunning();
      proc.sessionId = sessionId;
      proc.fold = emptyFold(sessionId);
      const startedAt = now();
      const summary: Omit<AgentSummary, "hasProcess"> = {
        id: agentId,
        harness: harness.id,
        repo,
        state: "done",
        sessionId,
        capabilities: { loadSession: initialized.agentCapabilities?.loadSession ?? false },
        startedAt,
        lastActivityAt: startedAt,
        ...(branch === undefined ? {} : { branch }),
        pendingPermissions: pendingPermissions(proc),
      };
      const added = putSummary(summary, "agent_added");
      proc.recorded = true;
      log("agent_started", { agentId, harness: harness.id });
      if (configOptions.length > 0) {
        safely(agentId, "config_option_update", () => {
          appendConfig(proc, configOptions);
        });
      }
      for (const { sessionId: from, update } of proc.held.splice(0)) handleUpdate(proc, from, update);
      return summaries.get(agentId) ?? added;
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
    const proc = liveProc(agentId);
    if (!proc) return sendResuming(agentId, text, commandId);
    if (proc.turn) throw busy(STILL_WORKING);
    if (proc.hidden) throw busy(HIDDEN_BUSY);
    const at = now();
    const [seq = 0] = appendLog(proc, [
      { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) },
    ]);
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(proc, "working", { lastUserAt: at }));
    proc.turn = true;
    log("turn_started", { agentId, seq });
    void runTurn(proc, text);
    return { seq };
  };

  /**
   * `sendNow` for an agent without a live process: stores the message, then resumes the agent and runs its turn in the
   * background (`resumeTurn`); the caller gets the message's seq at once.
   */
  const sendResuming = (agentId: string, text: string, commandId: string | undefined): { seq: number } => {
    const summary = summaries.get(agentId);
    if (!summary) throw notFound(agentId);
    if (pendingTurns.has(agentId)) throw busy(STILL_WORKING);
    if (!canResumeAgent(summary)) throw notResumable();
    const at = now();
    const message: NewLogEntry = { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) };
    // A resume that has folded the log already (it is setting the agent's config again) folds the message too.
    const current = procs.get(agentId);
    const resumed = current?.recorded && !current.ending ? current : undefined;
    const [seq = 0] = resumed ? appendLog(resumed, [message]) : storeEntries(agentId, [message]).seqs;
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    pendingTurns.add(agentId);
    safely(agentId, "turn_started", () => agentState(agentId, resumed, "working", { lastUserAt: at }));
    log("turn_started", { agentId, seq });
    void resumeTurn(agentId, text);
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
    appendLog(proc, [{ type: "permission_answered", at, sessionId: pending.sessionId, requestId, kind }]);
    proc.pending.delete(requestId);
    const state = proc.pending.size === 0 ? "working" : "waiting";
    safely(agentId, "permission_answered", () => setState(proc, state, { lastUserAt: at }));
    log("permission_answered", { agentId, requestId, kind });
    pending.respond({ outcome: { outcome: "selected", optionId } });
  };

  /**
   * Sets one of the agent's config options, checked against its latest stored options; returns once the agent's new
   * options are stored. An agent without a process is resumed first (`ensureRunning`). A value the agent refuses fails with `agent_error`, its message carrying the agent's own.
   */
  const setConfig = async (agentId: string, configId: string, value: string | boolean) => {
    // A set on an agent without a process starts it, as a message does.
    const proc = await ensureRunning(agentId);
    const set = proc.setting.then(() => setOne(proc, configId, value));
    proc.setting = set.catch(() => undefined);
    return set;
  };

  /** One set on a running agent, after the ones before it (`Proc.setting`). */
  const setOne = async (proc: Proc, configId: string, value: string | boolean) => {
    const { agentId } = proc;
    if (proc.ending || procs.get(agentId) !== proc) throw notRunning(canResume(proc.harness));
    if (proc.hidden) throw busy(HIDDEN_BUSY);
    const option = proc.config?.find(({ id }) => id === configId);
    if (option === undefined) {
      const ids = (proc.config ?? []).map(({ id }) => id);
      throw new AgentError(
        "invalid_request",
        `The agent has no config option "${configId}". ${ids.length === 0 ? "It offers none." : `Set one of: ${ids.join(", ")}.`}`,
      );
    }
    checkConfigValue(option, value);
    let options: unknown[];
    try {
      options = await setConfigWithin(proc, configId, value, CONFIG_SET_TIMEOUT_MS);
    } catch (error) {
      if (proc.acp.isClosed() || proc.ending) throw notRunning(canResume(proc.harness));
      if (error instanceof AgentError) {
        log("config_unanswered", { agentId, configId: safeName(configId) });
        throw error;
      }
      const code = rpcCode(error);
      log("config_refused", { agentId, configId: safeName(configId), code: code ?? -1 });
      const said = rpcMessage(error);
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent refused to set "${configId}"${code === undefined ? "" : ` (ACP error ${code})`}; it keeps its current settings. ` +
          `Pick another value, or try again.${said === undefined || said === "" ? "" : ` The agent said: ${said}`}`,
      );
    }
    if (proc.ending === "remove" || !summaries.has(agentId)) throw notFound(agentId);
    if (!appendConfig(proc, options)) {
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent set "${configId}" but answered with options the service can't read. Check that the agent is up to date, then try again.`,
      );
    }
    log("config_set", { agentId, configId: safeName(configId) });
  };

  const cancel = async (agentId: string) => {
    assertOpen();
    const summary = summaries.get(agentId);
    if (!summary) throw notFound(agentId);
    if (pendingTurns.has(agentId)) {
      // The message waits for the agent to start: it is ended there, before it is sent (`resumeTurn`).
      cancelledTurns.add(agentId);
      log("turn_cancel_sent", { agentId, permissionsCancelled: 0 });
      return;
    }
    const proc = procs.get(agentId);
    if (!proc?.recorded || proc.ending) throw notRunning(canResumeAgent(summary));
    try {
      await proc.acp.cancel(proc.sessionId);
    } catch {
      // The connection closed meanwhile; the close handler records it.
    }
    // ACP: after session/cancel, the client answers the turn's open permission requests with `cancelled`.
    const cancelled = cancelPending(proc);
    const state = proc.turn ? "working" : summaries.get(agentId)?.state;
    if (cancelled > 0 && state) safely(agentId, "cancel", () => setState(proc, state));
    log("turn_cancel_sent", { agentId, permissionsCancelled: cancelled });
  };

  /**
   * Ends the agent's process and, when a resume is under way, the process it produces: a stop or delete never leaves
   * one running that nothing can stop. False when there was neither.
   */
  const endAgent = async (agentId: string, why: "stop" | "remove") => {
    const end = async (proc: Proc) => {
      if (why === "remove") proc.ending = "remove";
      else proc.ending ??= "stop";
      revokeToken(proc);
      await terminate(proc);
    };
    const proc = procs.get(agentId);
    if (proc) await end(proc);
    const attempt = resuming.get(agentId);
    const resumed = attempt && (await attempt.catch(() => undefined));
    if (resumed && resumed !== proc) await end(resumed);
    return proc !== undefined || attempt !== undefined;
  };

  const stop = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    if (!(await endAgent(agentId, "stop"))) return;
    log("agent_stopped", { agentId });
  };

  const remove = async (agentId: string) => {
    assertOpen();
    if (!summaries.has(agentId)) throw notFound(agentId);
    await endAgent(agentId, "remove");
    const seq = store.deleteAgent(agentId);
    summaries.delete(agentId);
    commandIds.delete(agentId);
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

  /**
   * The agent's context breakdown, by a hidden turn its harness drives: nothing of the turn reaches the log, the
   * summary or the events, and nothing else runs on the agent meanwhile. A request while one runs gets its report;
   * refused while a turn runs (`busy`), and `unsupported` while the agent's latest command list lacks its harness's
   * `contextCommand`. A failure answers `agent_error` with the agent's message, and the agent stays as it was. An agent
   * without a process is resumed first (`ensureRunning`).
   */
  const contextBreakdown = async (agentId: string): Promise<ContextBreakdown> => {
    assertOpen();
    const summary = summaries.get(agentId);
    if (!summary) throw notFound(agentId);
    const harness = findHarness(summary.harness, harnesses);
    const report = harness?.contextBreakdown;
    if (harness === undefined || report === undefined) {
      throw new AgentError(
        AgentErrorCode.enum.unsupported,
        `${harness?.name ?? summary.harness} doesn't report its context. Use an agent whose harness offers the context feature.`,
      );
    }
    const turnBusy = () => busy("The agent is working on a turn; its context is available once it is idle. Try again then.");
    if (pendingTurns.has(agentId)) throw turnBusy();
    // Asking an agent without a process starts it, as a message does.
    const proc = await ensureRunning(agentId);
    // A message may have come while the agent was being resumed.
    const command = harness.contextCommand;
    const gate = contextGate({
      reporting: proc.contextReport !== undefined,
      command,
      commands: proc.commands,
      turn: proc.turn || pendingTurns.has(agentId),
      hidden: proc.hidden,
    });
    if (gate === "join" && proc.contextReport) return proc.contextReport;
    if (gate === "unsupported") {
      throw new AgentError(
        AgentErrorCode.enum.unsupported,
        `This agent doesn't list /${command ?? ""} among its commands, so it can't report its context. Try again once ` +
          `it has listed its commands; if it never offers /${command ?? ""}, update ${harness.name}.`,
      );
    }
    if (gate === "turn_busy") throw turnBusy();
    if (gate === "hidden_busy") throw busy(HIDDEN_BUSY);
    const running = hiddenReport(proc, report);
    proc.contextReport = running;
    const settled = () => {
      if (proc.contextReport === running) proc.contextReport = undefined;
    };
    running.then(settled, settled);
    return running;
  };

  /** Runs the harness's `report` as a hidden turn on `proc` (`contextBreakdown`), which has checked it may. */
  const hiddenReport = async (proc: Proc, report: NonNullable<Harness["contextBreakdown"]>): Promise<ContextBreakdown> => {
    const { agentId } = proc;
    proc.hidden = true;
    // The hidden turn's prompts still unanswered: it stays hidden until the agent has answered them all, even when
    // the harness gave up on one earlier.
    let open = 0;
    let ended = false;
    const unhide = () => {
      if (ended && open === 0) proc.hidden = false;
    };
    try {
      return await report({
        prompt: (text) => {
          open += 1;
          return proc.acp.prompt(proc.sessionId, text).finally(() => {
            open -= 1;
            unhide();
          });
        },
        nextExt: (method, match, timeoutMs) => nextExt(proc, method, match, timeoutMs),
        home: proc.home,
      });
    } catch (error) {
      if (proc.acp.isClosed() || proc.ending) throw notRunning(canResume(proc.harness));
      const code = rpcCode(error);
      log("context_failed", { agentId, code: code ?? -1 });
      const said = rpcMessage(error);
      // An ACP error is the agent's, and may pass: try again. Anything else is the harness's, whose message names the
      // remedy.
      const next =
        code === undefined
          ? (said ?? "")
          : `Try again.${said === undefined || said === "" ? "" : ` The agent said: ${said}`}`;
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent couldn't report its context${code === undefined ? "" : ` (ACP error ${code})`}; it keeps running as it was.${next === "" ? "" : ` ${next}`}`,
      );
    } finally {
      ended = true;
      // A prompt the harness no longer waits for is cancelled; the turn stays hidden until the agent answers it.
      if (open > 0) {
        log("context_cancelled", { agentId });
        void proc.acp.cancel(proc.sessionId).catch(() => undefined);
      }
      unhide();
    }
  };

  /** The agent's live cache state (`AgentSummary.cache`): undefined without a process, null when none is known. */
  const liveCache = (agentId: string): CacheState | null | undefined => procs.get(agentId)?.cache;

  return {
    start,
    send,
    contextBreakdown,
    answer,
    setConfig,
    cancel,
    stop,
    delete: remove,
    shutdown,
    onCommitted,
    setMcpUrl,
    agentForToken,
    proposalCommitted,
    liveCache,
  };
};

export type Manager = ReturnType<typeof createManager>;
