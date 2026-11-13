import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { AgentErrorCode } from "@wombat/shared/api";

import { startAgentProcess, type AgentScope, type Harness } from "../harness/harness.ts";
import type { Log } from "../log.ts";
import { connectAgent, type AgentHandlers } from "./acp-client.ts";
import { ACP_AUTH_REQUIRED, AgentError, rpcCode } from "./errors.ts";
import type { McpTokens } from "./mcp-tokens.ts";
import { isClosed, next, STARTING, type AgentPhase } from "./phase.ts";
import type { Proc } from "./proc.ts";
import type { createScopes } from "./scope.ts";
import { settleWithin } from "./timeout.ts";

/** How long an agent gets to exit after SIGTERM before its process group is killed. */
const KILL_GRACE_MS = 2_000;
/** How long after an agent exits its stdio may stay open (still being read) before the service drops it. */
const CLOSE_GRACE_MS = 500;

const killGroup = (pid: number | undefined, signal: NodeJS.Signals) => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already.
  }
};

export const startFailure = (error: unknown, harness: Harness, proc: Proc) => {
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

/** `AgentHandlers` for a given process. */
export type ProcHandlers = {
  [K in keyof AgentHandlers]: (proc: Proc, ...args: Parameters<AgentHandlers[K]>) => ReturnType<AgentHandlers[K]>;
};

export type AgentProcessDeps = {
  env: NodeJS.ProcessEnv;
  log: Log;
  scopes: Pick<ReturnType<typeof createScopes>, "kill">;
  readInstructions: () => Promise<string | undefined>;
  mcpServersFor: McpTokens["mcpServersFor"];
  revokeToken: McpTokens["revokeToken"];
  handlers: ProcHandlers;
  /** The other modules' steps once a process closed; `closing` is its phase before. Must not throw. */
  closed: (proc: Proc, closing: AgentPhase, code: number | null, signal: NodeJS.Signals | null) => void;
};

/** Spawns agent processes, ends them, and holds the live one per agent. */
export const createAgentProcess = ({ env, log, scopes, readInstructions, mcpServersFor, revokeToken, handlers, closed: onClosed }: AgentProcessDeps) => {
  const procs = new Map<string, Proc>();

  const procOf = (agentId: string) => procs.get(agentId);

  const hasProcess = (agentId: string) => procs.has(agentId);

  /** Whether `proc` is its agent's live process. */
  const isCurrent = (proc: Proc) => procs.get(proc.agentId) === proc;

  const liveProcs = () => [...procs.values()];

  /** Starts the agent's process and makes it the agent's live one. */
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
        update: (sessionId, update) => handlers.update(proc, sessionId, update),
        permission: (request) => handlers.permission(proc, request),
        ext: (method, params) => handlers.ext(proc, method, params),
      }),
      tokenKey: undefined,
      closed,
      sessionId: "",
      phase: STARTING,
      held: [],
      pending: new Map(),
      fold: undefined,
      config: undefined,
      commands: undefined,
      skipped: 0,
      cache: null,
    };

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (isClosed(proc.phase)) return;
      const closing = proc.phase;
      proc.phase = next(closing, { type: "closed" });
      revokeToken(proc);
      // A resume may already have put a new process in its place.
      if (procs.get(agentId) === proc) procs.delete(agentId);
      proc.acp.close();
      onClosed(proc, closing, code, signal);
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
      proc.phase = next(proc.phase, { type: "exited" });
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
    procs.set(agentId, proc);
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

  return { spawnAgent, terminate, sessionExtra, procOf, hasProcess, isCurrent, liveProcs };
};

export type AgentProcess = ReturnType<typeof createAgentProcess>;
