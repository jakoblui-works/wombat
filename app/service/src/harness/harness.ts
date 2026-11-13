import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AgentSummary, ContextBreakdown } from "@wombat/shared/api";

/** How to start an agent: the command line comes from the harness alone, never from a caller. */
export type SpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

/** The name agents know the service's MCP server (`/mcp`) by; Claude Code's names for its tools start `mcp__wombat__`. */
export const MCP_SERVER_NAME = "wombat";

/** An agent program the service can start, speaking ACP over stdio. */
export type Harness = {
  id: string;
  name: string;
  /** Shown when the agent reports it needs a login. */
  loginHint: string;
  /** `source` is the environment the agent's is filtered from (see `agentEnv`); defaults to the service's. */
  spawn: (cwd: string, source?: NodeJS.ProcessEnv) => SpawnSpec;
  /**
   * Whether an agent without a process can be started again in its stored session (the `resume` feature on `GET
   * /harnesses`): its next message, setting or `/context` spawns it and sends ACP `session/resume`. The service still
   * checks that `initialize` advertises `sessionCapabilities.resume`, and fails the resume without it.
   */
  resumable?: boolean;
  /** Sent as `session/new`'s (and `session/resume`'s) `_meta`: options only this harness reads. */
  sessionMeta?: Record<string, unknown>;
  /**
   * Turns the instructions file's text into `session/new` parameters, merged in by the manager (the Claude Code
   * harness: the top-level `systemPrompt`, mode append). Without it, nothing about the instructions is sent.
   */
  sessionParams?: (instructions: string) => Record<string, unknown>;
  /**
   * Optional (the `context` feature on `GET /harnesses`): the agent's context breakdown, by a hidden turn the harness
   * drives through `agent`. The manager hides that turn's updates and keeps everything else off the agent meanwhile;
   * the harness never touches the log. The core relies on it nowhere: without it, `POST /agents/:id/context` answers
   * `unsupported`.
   */
  contextBreakdown?: (agent: ContextAgent) => Promise<ContextBreakdown>;
  /**
   * Optional: the command (without its `/`) the agent must list in its latest `available_commands_update` before
   * `contextBreakdown` runs; until it does, `POST /agents/:id/context` answers `unsupported`. Without it, no such check.
   */
  contextCommand?: string;
  /**
   * Optional: called for every ACP extension notification the agent sends (any method but `session/update`).
   * `previous` is the agent's current cache state (the manager always passes it; optional so a caller without an
   * agent can ask what a notification alone says): the harness object is shared by every agent and keeps no state.
   * A `cache` in the result becomes the agent's cache state (`AgentSummary.cache`, never stored). The core relies on it
   * nowhere: without it, extension notifications are dropped and agents have no cache state.
   */
  extNotification?: (method: string, params: unknown, previous?: CacheState | null) => { cache?: CacheState | null } | undefined;
};

/** What a harness's `contextBreakdown` gets of the agent. */
export type ContextAgent = {
  /** Sends `text` as a prompt in the agent's session; resolves to the agent's answer, rejects with its error. */
  prompt: (text: string) => Promise<unknown>;
  /**
   * The params of the agent's next extension notification `method` that `match` accepts, from the call on; rejects
   * after `timeoutMs` or when the agent's process ends. Call it before `prompt` when the notification may come first.
   */
  nextExt: (method: string, match: (params: unknown) => boolean, timeoutMs: number) => Promise<unknown>;
  /** The agent's HOME from its spawn environment, if it has one: paths under it may be shown with `~`. */
  home: string | undefined;
};

/** An agent's prompt-cache state (`AgentSummary.cache` when known). */
export type CacheState = NonNullable<AgentSummary["cache"]>;

/** A systemd user scope to run an agent in: `unit` is the scope's name, `slice` the slice it goes in. */
export type AgentScope = { unit: string; slice: string };

/**
 * Starts an agent process. No shell, so args and cwd reach the agent literally; `detached` puts it in its own
 * process group, so stopping it can kill everything it started. With a scope, systemd-run (found on the spec's
 * PATH) puts it in a cgroup first, which also holds helpers that leave its group or session; systemd-run execs
 * the agent in place, so the pid and stdio are still the agent's.
 */
export const startAgentProcess = (
  spec: SpawnSpec,
  opts: { scope?: AgentScope } = {},
): ChildProcessWithoutNullStreams => {
  const { scope } = opts;
  const [command, args] = scope
    ? [
        "systemd-run",
        [
          "--user",
          "--scope",
          "--quiet",
          "--collect",
          `--slice=${scope.slice}`,
          `--unit=${scope.unit}`,
          "--property=TimeoutStopSec=10s",
          "--",
          spec.command,
          ...spec.args,
        ],
      ]
    : [spec.command, spec.args];
  return spawn(command, args, { cwd: spec.cwd, env: spec.env, shell: false, stdio: "pipe", detached: true });
};
