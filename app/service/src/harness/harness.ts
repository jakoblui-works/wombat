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
