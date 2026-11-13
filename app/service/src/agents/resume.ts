import type { InitializeResponse } from "@agentclientprotocol/sdk";
import { AgentErrorCode, configToRestore, type AgentSummary } from "@wombat/shared/api";
import { commandsOf, configOf, foldLog } from "@wombat/shared/log-fold";

import type { Harness } from "../harness/harness.ts";
import { canResume, findHarness } from "../harness/registry.ts";
import { safeName, type Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { RepoError, resolveRepo } from "../workspace.ts";
import { START_TIMEOUT_MS, startFailure, type AgentProcess } from "./agent-process.ts";
import type { AgentRecord } from "./agent-record.ts";
import { ConfigOptions, setConfigWithin, type Config } from "./config.ts";
import { ACP_AUTH_REQUIRED, AgentError, notFound, notResumable, requireAgent, rpcCode } from "./errors.ts";
import { endingByService, takesCalls } from "./phase.ts";
import type { Proc } from "./proc.ts";
import type { createScopes } from "./scope.ts";
import type { Turns } from "./turns.ts";

/** The agent's folder for `repo`, which must resolve inside the workspace. */
export const folderOf = (workspaceRoot: string, repo: string) => {
  try {
    return resolveRepo(workspaceRoot, repo);
  } catch (error) {
    if (error instanceof RepoError) throw new AgentError(error.code, error.message);
    throw error;
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

export type ResumeDeps = {
  workspaceRoot: string;
  harnesses: readonly Harness[];
  log: Log;
  readLog: Store["readLog"];
  scopes: Pick<ReturnType<typeof createScopes>, "scopeFor">;
  /** Throws once the service is shutting down. */
  assertOpen: () => void;
  summaryOf: AgentRecord["summaryOf"];
  hasAgent: AgentRecord["hasAgent"];
  putSummary: AgentRecord["putSummary"];
  setState: AgentRecord["setState"];
  safely: AgentRecord["safely"];
  recordSession: AgentRecord["recordSession"];
  appendConfig: Config["appendConfig"];
  spawnAgent: AgentProcess["spawnAgent"];
  openSession: AgentProcess["openSession"];
  abandon: AgentProcess["abandon"];
  procOf: AgentProcess["procOf"];
  isCurrent: AgentProcess["isCurrent"];
  hasProcess: AgentProcess["hasProcess"];
  hasPendingTurn: Turns["hasPendingTurn"];
};

/** Takes up a stored agent's session in a new process, for a message or setting that needs one. */
export const createResume = (deps: ResumeDeps) => {
  const {
    workspaceRoot,
    harnesses,
    log,
    readLog,
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
    hasPendingTurn,
  } = deps;
  // The one resume under way per agent (`ensureRunning`): every caller waiting for the agent's process shares it.
  const resuming = new Map<string, Promise<Proc>>();

  const resumeOf = (agentId: string) => resuming.get(agentId);

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
    return proc && takesCalls(proc.phase) && !resuming.has(agentId) && !hasPendingTurn(agentId) ? proc : undefined;
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
    const cwd = folderOf(workspaceRoot, summary.repo);
    const scope = await scopes.scopeFor(agentId);
    assertOpen();
    const proc = spawnAgent(agentId, harness, cwd, scope);
    log("agent_resuming", { agentId, harness: harness.id });
    const tooSlow = () =>
      new AgentError(
        AgentErrorCode.enum.agent_failed,
        `${harness.name} didn't take up this chat's session again within ${START_TIMEOUT_MS / 1000} s. Send the message again to retry.`,
      );
    const canTakeUp = (initialized: InitializeResponse) => {
      if (!initialized.agentCapabilities?.sessionCapabilities?.resume) {
        throw new AgentError(
          AgentErrorCode.enum.agent_failed,
          `This version of ${harness.name} can't take up a stored session, so this chat can't go on. Update it and send the message again, or start a new agent; this one's history is kept.`,
        );
      }
    };
    try {
      const {
        session: { configOptions },
      } = await openSession(proc, tooSlow, (extra) => proc.acp.resumeSession(sessionId, cwd, extra), canTakeUp);
      requireAgent(agentId, summaryOf);
      const stored = recordSession(proc, configOptions, true, () => {
        proc.sessionId = sessionId;
        proc.fold = foldLog(readLog(agentId).entries, sessionId);
        proc.config = configOf(proc.fold);
        proc.commands = commandsOf(proc.fold);
        return proc.config;
      });
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
      const running = !endingByService(proc.phase) && isCurrent(proc);
      if (running && !hasPendingTurn(agentId)) safely(agentId, "resumed", () => setState(proc, "done"));
      log("agent_resumed", { agentId, harness: harness.id });
      return proc;
    } catch (error) {
      const failure = error instanceof AgentError || rpcCode(error) === ACP_AUTH_REQUIRED || proc.acp.isClosed() ? startFailure(error, harness, proc) : refusedResume(error, harness);
      await abandon(proc);
      // The summary was written while the attempt's process ran (a message stored meanwhile): it has none now.
      const current = summaryOf(agentId);
      if (current?.hasProcess && !hasProcess(agentId)) safely(agentId, "resume_failed", () => putSummary(current, "agent_changed"));
      log("agent_resume_failed", { agentId, harness: harness.id, code: failure.code });
      throw failure;
    }
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

  return { ensureRunning, liveProc, canResumeAgent, resumeOf };
};

export type Resume = ReturnType<typeof createResume>;
