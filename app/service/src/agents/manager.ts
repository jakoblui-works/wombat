import { randomUUID } from "node:crypto";

import { AgentErrorCode, PROPOSAL_ALERT, type AgentSummary } from "@wombat/shared/api";
import { emptyFold } from "@wombat/shared/log-fold";

import type { CacheState, Harness } from "../harness/harness.ts";
import { defaultHarnesses, findHarness } from "../harness/registry.ts";
import { logToStderr, type Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { createAgentProcess, START_TIMEOUT_MS, startFailure, type AgentProcessDeps } from "./agent-process.ts";
import { createAgentRecord } from "./agent-record.ts";
import { CONFIG_SET_TIMEOUT_MS, createConfig } from "./config.ts";
import { AgentError, requireAgent } from "./errors.ts";
import { createHiddenTurn } from "./hidden-turn.ts";
import { createMcpTokens } from "./mcp-tokens.ts";
import { createPermissions, pendingPermissions } from "./permissions.ts";
import { next } from "./phase.ts";
import { now, type Proc } from "./proc.ts";
import { createResume, folderOf } from "./resume.ts";
import { createScopes, DEFAULT_SLICE } from "./scope.ts";
import { createTurns } from "./turns.ts";

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
  const isShuttingDown = () => shuttingDown !== undefined;
  const scopes = createScopes({ slice, env, log });

  // Modules reach names defined further down (`hasProcess`, `isCurrent`, `procOf`, `appendConfig`, `ensureRunning`,
  // `hasPendingTurn`) through late-bound arrows. None is called before its name is defined: `markStored` runs after
  // `createAgentProcess`, the rest only once `createManager` has returned.
  const {
    emit,
    onCommitted,
    summaryOf,
    hasAgent,
    forget,
    putSummary,
    storeEntries,
    appendLog,
    setState,
    agentState,
    branchOf,
    refreshBranch,
    safely,
    knownCommands,
    handleUpdate,
    recordSession,
    recordClosed,
    markStored,
  } = createAgentRecord({
    store,
    log,
    hasProcess: (agentId) => hasProcess(agentId),
    isCurrent: (proc) => isCurrent(proc),
    shuttingDown: isShuttingDown,
    appendConfig: (proc, options) => appendConfig(proc, options),
  });
  const { mcpServersFor, revokeToken, setMcpUrl, agentForToken } = createMcpTokens({
    isCurrent: (proc) => isCurrent(proc),
    shuttingDown: isShuttingDown,
  });

  const assertOpen = () => {
    if (isShuttingDown()) {
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
    isCurrent: (proc) => isCurrent(proc),
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
    hasPendingTurn: (agentId) => hasPendingTurn(agentId),
  });

  const processClosed: AgentProcessDeps["closed"] = (proc, closing, code, signal) => {
    // Cancelled before the state is written: the state's pendingPermissions are read from the open requests.
    cancelPending(proc);
    rejectExtWaiters(proc);
    recordClosed(proc, closing, code, signal);
  };

  const { spawnAgent, terminate, openSession, abandon, procOf, hasProcess, isCurrent, liveProcs } = createAgentProcess({
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

  const { ensureRunning, liveProc, canResumeAgent, resumeOf } = createResume({
    workspaceRoot,
    harnesses,
    log,
    readLog: store.readLog,
    scopes,
    assertOpen,
    summaryOf,
    hasAgent,
    putSummary,
    setState,
    safely,
    recordSession,
    appendConfig,
    spawnAgent,
    openSession,
    abandon,
    procOf,
    isCurrent,
    hasProcess,
    hasPendingTurn: (agentId) => hasPendingTurn(agentId),
  });
  const { send, cancel, hasPendingTurn } = createTurns({
    log,
    assertOpen,
    summaryOf,
    hasAgent,
    storeEntries,
    appendLog,
    setState,
    agentState,
    refreshBranch,
    knownCommands,
    safely,
    cancelPending,
    procOf,
    isCurrent,
    liveProc,
    canResumeAgent,
    ensureRunning,
  });

  const start = async (harnessId: string, repo: string): Promise<AgentSummary> => {
    assertOpen();
    const harness = findHarness(harnessId, harnesses);
    if (!harness) {
      throw new AgentError(AgentErrorCode.enum.unknown_harness, `There's no harness "${harnessId}". List the harnesses to see which exist.`);
    }
    const cwd = folderOf(workspaceRoot, repo);
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
      const {
        initialized,
        session: { sessionId, configOptions },
      } = await openSession(proc, tooSlow, (extra) => proc.acp.newSession(cwd, extra));
      const branch = await branchOf(agentId, cwd);
      const added = recordSession(proc, configOptions, false, () => {
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
        const stored = putSummary(summary, "agent_added");
        log("agent_started", { agentId, harness: harness.id });
        return stored;
      });
      return summaryOf(agentId) ?? added;
    } catch (error) {
      const failure = startFailure(error, harness, proc);
      await abandon(proc);
      log("agent_start_failed", { agentId, harness: harness.id, code: failure.code });
      throw failure;
    }
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
    const attempt = resumeOf(agentId);
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
