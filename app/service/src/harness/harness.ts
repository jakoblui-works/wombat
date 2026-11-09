import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** How to start an agent: the command line comes from the harness alone, never from a caller. */
export type SpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

/** An agent program the service can start, speaking ACP over stdio. */
export type Harness = {
  id: string;
  name: string;
  /** Shown when the agent reports it needs a login. */
  loginHint: string;
  /** `source` is the environment the agent's is filtered from (see `agentEnv`); defaults to the service's. */
  spawn: (cwd: string, source?: NodeJS.ProcessEnv) => SpawnSpec;
};

/**
 * Starts an agent process. No shell, so args and cwd reach the agent literally; `detached` puts it in its own
 * process group, so stopping it can kill everything it started.
 */
export const startAgentProcess = (spec: SpawnSpec): ChildProcessWithoutNullStreams =>
  spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, stdio: "pipe", detached: true });
