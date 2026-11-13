import { randomUUID } from "node:crypto";

import {
  AgentErrorCode,
  LogEntry,
  parseLogEntry,
  PROPOSAL_ALERT,
  SERVICE_STOP_REASON,
  type AgentSummary,
  type SendMessageRequest,
  configToRestore,
} from "@wombat/shared/api";
import { commandsOf, configOf, emptyFold, foldLog } from "@wombat/shared/log-fold";

import type { CacheState, Harness } from "../harness/harness.ts";
import { canResume, defaultHarnesses, findHarness } from "../harness/registry.ts";
import { logToStderr, safeName, type Log } from "../log.ts";
import type { NewLogEntry, Store } from "../store/store.ts";
import { RepoError, resolveRepo } from "../workspace.ts";
import { createAgentProcess, startFailure } from "./agent-process.ts";
import { createAgentRecord } from "./agent-record.ts";
import { CONFIG_SET_TIMEOUT_MS, ConfigOptions, createConfig, setConfigWithin } from "./config.ts";
import {
  ACP_AUTH_REQUIRED,
  AgentError,
  busy,
  notFound,
  notResumable,
  notRunning,
  requireAgent,
  rpcCode,
} from "./errors.ts";
import { createHiddenTurn, HIDDEN_BUSY } from "./hidden-turn.ts";
import { createMcpTokens } from "./mcp-tokens.ts";
import { createPermissions, pendingPermissions } from "./permissions.ts";
import {
  endingByService,
  mayRecord,
  isHidden,
  isTurnOpen,
  next,
  recordsAgent,
  takesCalls,
  type AgentPhase,
} from "./phase.ts";
import { now, type Proc } from "./proc.ts";
import { createScopes, DEFAULT_SLICE } from "./scope.ts";
import { withTimeout } from "./timeout.ts";

export { AgentError, notFound, type AgentErrorCodes } from "./errors.ts";
export type { Committed } from "./agent-record.ts";

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
  /** How long a setting change waits for the agent's answer before failing. */
  configSetTimeoutMs?: number;
};

const START_TIMEOUT_MS = 60_000;
const STILL_WORKING = "The agent is still working on the last message. Wait for it to finish, or cancel it.";

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
  configSetTimeoutMs = CONFIG_SET_TIMEOUT_MS,
}: ManagerOptions) => {
  let shuttingDown: Promise<void> | undefined;
  const scopes = createScopes({ slice, env, log });
  // The one resume under way per agent (`ensureRunning`): every caller waiting for the agent's process shares it.
  const resuming = new Map<string, Promise<Proc>>();
  // Agents whose message is stored while their process is being resumed: the turn runs once it is (`resumeTurn`).
  const pendingTurns = new Set<string>();
  // Agents whose waiting message was cancelled before its resume finished: the turn ends without being sent.
  const cancelledTurns = new Set<string>();

  // Modules reach names defined further down (`hasProcess`, `isCurrent`, `procOf`, `ensureRunning`) through late-bound
  // arrows. None is called before its name is defined: `markStored` runs after `createAgentProcess`, the rest only once
  // `createManager` has returned.
  const {
    emit,
    onCommitted,
    summaryOf,
    hasAgent,
    forget,
    putSummary,
    storeEntries,
    appendLog,
    refreshFromFold,
    setState,
    agentState,
    branchOf,
    refreshBranch,
    safely,
    knownCommands,
    recordClosed,
    markStored,
  } = createAgentRecord({ store, log, hasProcess: (agentId) => hasProcess(agentId) });
  const { mcpServersFor, revokeToken, setMcpUrl, agentForToken } = createMcpTokens({
    isCurrent: (proc) => isCurrent(proc),
    shuttingDown: () => shuttingDown !== undefined,
  });

  const assertOpen = () => {
    if (shuttingDown) {
      throw new AgentError(
        AgentErrorCode.enum.not_running,
        "The agent service is shutting down and takes no more agent commands. Start the service again.",
      );
    }
  };

  const { requestPermission, cancelPending, answer } = createPermissions({
    log,
    assertOpen,
    summaryOf,
    procOf: (agentId) => procOf(agentId),
    appendLog,
    setState,
    safely,
  });
  const { setConfig, appendConfig } = createConfig({
    log,
    configSetTimeoutMs,
    procOf: (agentId) => procOf(agentId),
    hasAgent,
    appendLog,
    ensureRunning: (agentId) => ensureRunning(agentId),
  });
  const { contextBreakdown, handleExt, rejectExtWaiters } = createHiddenTurn({
    log,
    harnesses,
    assertOpen,
    summaryOf,
    putSummary,
    safely,
    ensureRunning: (agentId) => ensureRunning(agentId),
    hasPendingTurn: (agentId) => pendingTurns.has(agentId),
  });

  const handleUpdate = (proc: Proc, sessionId: string, update: unknown) => {
    if (!recordsAgent(proc.phase)) {
      proc.held.push({ sessionId, update });
      return;
    }
    const { agentId } = proc;
    const kind = safeName((update as { sessionUpdate?: unknown } | null)?.sessionUpdate);
    if (isHidden(proc.phase)) {
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
        const current = summaryOf(agentId);
        if (current) putSummary({ ...current, title: parsed.title, lastActivityAt: now() }, "agent_changed");
      }
      refreshFromFold(proc);
    });
  };

  const runTurn = async (proc: Proc, text: string) => {
    const { agentId } = proc;
    try {
      const { stopReason } = await proc.acp.prompt(proc.sessionId, text);
      proc.phase = next(proc.phase, { type: "turnEnded" });
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
      if (proc.acp.isClosed() || endingByService(proc.phase)) return;
      proc.phase = next(proc.phase, { type: "turnEnded" });
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

  const processClosed = (proc: Proc, closing: AgentPhase, code: number | null, signal: NodeJS.Signals | null) => {
    // Cancelled before the state is written: the state's pendingPermissions are read from the open requests.
    cancelPending(proc);
    rejectExtWaiters(proc);
    recordClosed(proc, closing, code, signal);
  };

  const { spawnAgent, terminate, sessionExtra, procOf, hasProcess, isCurrent, liveProcs } = createAgentProcess({
    env,
    log,
    scopes,
    readInstructions,
    mcpServersFor,
    revokeToken,
    handlers: { update: handleUpdate, permission: requestPermission, ext: handleExt },
    closed: processClosed,
  });

  markStored();

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
    const proc = procOf(agentId);
    return proc && takesCalls(proc.phase) && !resuming.has(agentId) && !pendingTurns.has(agentId) ? proc : undefined;
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
    await procOf(agentId)?.closed;
    if (!hasAgent(agentId)) {
      log("agent_resume_failed", { agentId, harness: harness.id, code: AgentErrorCode.enum.not_found });
      throw notFound(agentId);
    }
    const cwd = folderOf(summary.repo);
    const scope = await scopes.scopeFor(agentId);
    assertOpen();
    const proc = spawnAgent(agentId, harness, cwd, scope);
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
      requireAgent(agentId, summaryOf);
      if (shuttingDown || !mayRecord(proc.phase) || procOf(agentId) !== proc) throw notRunning(true);
      proc.sessionId = sessionId;
      proc.fold = foldLog(store.readLog(agentId).entries, sessionId);
      proc.config = configOf(proc.fold);
      proc.commands = commandsOf(proc.fold);
      const stored = proc.config;
      proc.phase = next(proc.phase, { type: "recorded" });
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
      const running = !endingByService(proc.phase) && procOf(agentId) === proc;
      if (running && !pendingTurns.has(agentId)) safely(agentId, "resumed", () => setState(proc, "done"));
      log("agent_resumed", { agentId, harness: harness.id });
      return proc;
    } catch (error) {
      const failure = error instanceof AgentError || rpcCode(error) === ACP_AUTH_REQUIRED || proc.acp.isClosed() ? startFailure(error, harness, proc) : refusedResume(error, harness);
      // Nothing was recorded, so the close handler writes nothing.
      proc.phase = next(proc.phase, { type: "endRequested", why: "remove" });
      await terminate(proc);
      // The summary was written while the attempt's process ran (a message stored meanwhile): it has none now.
      const current = summaryOf(agentId);
      if (current?.hasProcess && !hasProcess(agentId)) safely(agentId, "resume_failed", () => putSummary(current, "agent_changed"));
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
    const summary = requireAgent(agentId, summaryOf);
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
      resumed.phase = next(resumed.phase, { type: "turnStarted" });
      // Ending already: its close handler ends the turn.
      if (endingByService(resumed.phase) && procOf(agentId) === resumed) return;
      if (procOf(agentId) !== resumed) {
        // Ended already: its close handler wrote the agent's state, but saw no turn.
        resumed.phase = next(resumed.phase, { type: "turnEnded" });
        if (hasAgent(agentId)) safely(agentId, "turn_stopped", () => storeEntries(agentId, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }]));
        return;
      }
      if (cancelled) {
        // Cancelled while the agent was starting: the message never reaches it.
        resumed.phase = next(resumed.phase, { type: "turnEnded" });
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
    if (!hasAgent(agentId)) return;
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
      // Another live process, or none, means this one ended before its summary could be stored.
      if (shuttingDown || !mayRecord(proc.phase) || procOf(agentId) !== proc) throw notRunning();
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
      proc.phase = next(proc.phase, { type: "recorded" });
      log("agent_started", { agentId, harness: harness.id });
      if (configOptions.length > 0) {
        safely(agentId, "config_option_update", () => {
          appendConfig(proc, configOptions);
        });
      }
      for (const { sessionId: from, update } of proc.held.splice(0)) handleUpdate(proc, from, update);
      return summaryOf(agentId) ?? added;
    } catch (error) {
      const failure = startFailure(error, harness, proc);
      // Nothing was recorded, so the close handler writes nothing.
      proc.phase = next(proc.phase, { type: "endRequested", why: "remove" });
      await terminate(proc);
      log("agent_start_failed", { agentId, harness: harness.id, code: failure.code });
      throw failure;
    }
  };

  const sendNow = (agentId: string, { text, commandId }: SendMessageRequest): { seq: number } => {
    assertOpen();
    requireAgent(agentId, summaryOf);
    if (commandId !== undefined) {
      const seq = knownCommands(agentId).get(commandId);
      if (seq !== undefined) {
        log("message_repeated", { agentId, seq });
        return { seq };
      }
    }
    const proc = liveProc(agentId);
    if (!proc) return sendResuming(agentId, text, commandId);
    if (isTurnOpen(proc.phase)) throw busy(STILL_WORKING);
    if (isHidden(proc.phase)) throw busy(HIDDEN_BUSY);
    const at = now();
    const [seq = 0] = appendLog(proc, [
      { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) },
    ]);
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(proc, "working", { lastUserAt: at }));
    proc.phase = next(proc.phase, { type: "turnStarted" });
    log("turn_started", { agentId, seq });
    void runTurn(proc, text);
    return { seq };
  };

  /**
   * `sendNow` for an agent without a live process: stores the message, then resumes the agent and runs its turn in the
   * background (`resumeTurn`); the caller gets the message's seq at once.
   */
  const sendResuming = (agentId: string, text: string, commandId: string | undefined): { seq: number } => {
    const summary = requireAgent(agentId, summaryOf);
    if (pendingTurns.has(agentId)) throw busy(STILL_WORKING);
    if (!canResumeAgent(summary)) throw notResumable();
    const at = now();
    const message: NewLogEntry = { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) };
    // A resume that has folded the log already (it is setting the agent's config again) folds the message too.
    const current = procOf(agentId);
    const resumed = current && takesCalls(current.phase) ? current : undefined;
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

  const cancel = async (agentId: string) => {
    assertOpen();
    const summary = requireAgent(agentId, summaryOf);
    if (pendingTurns.has(agentId)) {
      // The message waits for the agent to start: it is ended there, before it is sent (`resumeTurn`).
      cancelledTurns.add(agentId);
      log("turn_cancel_sent", { agentId, permissionsCancelled: 0 });
      return;
    }
    const proc = procOf(agentId);
    if (!proc || !takesCalls(proc.phase)) throw notRunning(canResumeAgent(summary));
    try {
      await proc.acp.cancel(proc.sessionId);
    } catch {
      // The connection closed meanwhile; the close handler records it.
    }
    // ACP: after session/cancel, the client answers the turn's open permission requests with `cancelled`.
    const cancelled = cancelPending(proc);
    const state = isTurnOpen(proc.phase) ? "working" : summaryOf(agentId)?.state;
    if (cancelled > 0 && state) safely(agentId, "cancel", () => setState(proc, state));
    log("turn_cancel_sent", { agentId, permissionsCancelled: cancelled });
  };

  /**
   * Ends the agent's process and, when a resume is under way, the process it produces: a stop or delete never leaves
   * one running that nothing can stop. False when there was neither.
   */
  const endAgent = async (agentId: string, why: "stop" | "remove") => {
    const end = async (proc: Proc) => {
      proc.phase = next(proc.phase, { type: "endRequested", why });
      revokeToken(proc);
      await terminate(proc);
    };
    const proc = procOf(agentId);
    if (proc) await end(proc);
    const attempt = resuming.get(agentId);
    const resumed = attempt && (await attempt.catch(() => undefined));
    if (resumed && resumed !== proc) await end(resumed);
    return proc !== undefined || attempt !== undefined;
  };

  const stop = async (agentId: string) => {
    assertOpen();
    requireAgent(agentId, summaryOf);
    if (!(await endAgent(agentId, "stop"))) return;
    log("agent_stopped", { agentId });
  };

  const remove = async (agentId: string) => {
    assertOpen();
    requireAgent(agentId, summaryOf);
    await endAgent(agentId, "remove");
    const seq = store.deleteAgent(agentId);
    forget(agentId);
    if (seq !== undefined) emit({ seq, agentId, type: "agent_removed" });
    log("agent_deleted", { agentId });
  };

  /** Ends every agent's process group and scope, then the slice; later calls fail. Agents it ends are recorded as stopped. */
  const shutdown = () => {
    shuttingDown ??= (async () => {
      const running = liveProcs();
      for (const proc of running) {
        proc.phase = next(proc.phase, { type: "endRequested", why: "stop" });
        revokeToken(proc);
      }
      await Promise.all(running.map(terminate));
      await scopes.stopSlice();
      log("shutdown", { agents: running.length });
    })();
    return shuttingDown;
  };

  /** Tells the listeners about a committed proposal change (stored, approved, rejected, conflict). */
  const proposalCommitted = (proposalId: string, seq: number) => emit({ seq, type: PROPOSAL_ALERT, proposalId });

  /** The agent's live cache state (`AgentSummary.cache`): undefined without a process, null when none is known. */
  const liveCache = (agentId: string): CacheState | null | undefined => procOf(agentId)?.cache;

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
