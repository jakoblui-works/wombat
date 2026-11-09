import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

import { agentEnv } from "../harness/env.ts";
import type { Log } from "./manager.ts";

/** The slice agents' scopes go in, so everything the service started can be found and stopped together. */
export const DEFAULT_SLICE = "wombat-agents.slice";

/** How long `is-system-running` and `is-active` may take: a user manager that doesn't answer by then is unusable. */
const QUERY_TIMEOUT_MS = 3_000;
/** A stuck `systemctl kill` is killed after this; nobody waits for it that long. */
const KILL_TIMEOUT_MS = 5_000;
/** Scopes get TimeoutStopSec=10s, so stopping the slice may take that long, plus some slack. */
const STOP_TIMEOUT_MS = 15_000;

const unitFor = (agentId: string) => `wombat-agent-${agentId}.scope`;

/** Why agents can't get scopes, as a log-safe state. */
type Unavailable = "tools_missing" | "manager_unreachable" | "manager_offline";

const onPath = (tool: string, env: NodeJS.ProcessEnv) =>
  (env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => {
      const path = join(dir, tool);
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });

/**
 * Runs `systemctl --user <args>`, found on `env.PATH`. Its stderr is never read and its stdout only when asked
 * for, so what the tool prints can't reach a log line; `code` is null when it couldn't run or timed out.
 */
const systemctl = (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, readStdout = false) =>
  new Promise<{ code: number | null; stdout: string }>((resolve) => {
    let stdout = "";
    const child = spawn("systemctl", ["--user", ...args], {
      env,
      shell: false,
      stdio: ["ignore", readStdout ? "pipe" : "ignore", "ignore"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < 1_024) stdout += chunk;
    });
    child.once("error", () => resolve({ code: null, stdout: "" }));
    child.once("close", (code) => resolve({ code, stdout: stdout.trim() }));
  });

const detect = async (env: NodeJS.ProcessEnv): Promise<Unavailable | undefined> => {
  if (!onPath("systemd-run", env) || !onPath("systemctl", env)) return "tools_missing";
  // It exits non-zero for any state but `running` (a degraded manager still runs scopes), so only what it
  // printed counts; a manager it can't reach prints nothing on stdout.
  const { stdout } = await systemctl(["is-system-running"], env, QUERY_TIMEOUT_MS, true);
  const state = stdout.split("\n")[0]?.trim() ?? "";
  if (state === "") return "manager_unreachable";
  if (state === "offline") return "manager_offline";
  return undefined;
};

export type ScopeOptions = { slice: string; env: NodeJS.ProcessEnv; log: Log };

/**
 * Systemd user scopes for agents: a cgroup holds everything an agent started, helpers that left its process
 * group or session included, so killing the scope ends them all. Where there's no usable user manager, agents
 * run as plain process groups and every start says so.
 */
export const createScopes = ({ slice, env: source, log }: ScopeOptions) => {
  // What systemd-run gets with the agent, so detection only passes if the agents' scopes can be created.
  const env = agentEnv(source);
  const settled = (async () => {
    const unavailable = await detect(env);
    if (unavailable !== undefined) return unavailable;
    // Agents of a service that died without shutting down; stopped before any new agent joins the slice.
    const { stdout } = await systemctl(["is-active", slice], env, QUERY_TIMEOUT_MS, true);
    if (stdout === "active") {
      const { code } = await systemctl(["stop", slice], env, STOP_TIMEOUT_MS);
      log("scope_leftovers_stopped", { slice, result: code === 0 ? "ok" : "failed" });
    }
    return undefined;
  })();

  /** The scope for a new agent, or undefined (with a warning) when agents can't have one. */
  const scopeFor = async (agentId: string) => {
    const unavailable = await settled;
    if (unavailable !== undefined) {
      log("scope_unavailable", { agentId, reason: unavailable });
      return undefined;
    }
    return { unit: unitFor(agentId), slice };
  };

  /** Never rejects. A failure is logged only if the scope may still hold something. */
  const kill = async (agentId: string, unit: string) => {
    const { code } = await systemctl(["kill", "--signal=SIGKILL", unit], env, KILL_TIMEOUT_MS);
    if (code === 0) return;
    // With --collect the scope is gone once the group kill emptied it, and killing a gone unit fails.
    const { stdout } = code === null ? { stdout: "" } : await systemctl(["is-active", unit], env, QUERY_TIMEOUT_MS, true);
    if (stdout !== "inactive" && stdout !== "failed") log("scope_kill_failed", { agentId, unit, code: code ?? -1 });
  };

  /** Stops the whole slice, for shutdown; a no-op where agents have no scopes. */
  const stopSlice = async () => {
    if ((await settled) !== undefined) return;
    const { code } = await systemctl(["stop", slice], env, STOP_TIMEOUT_MS);
    if (code !== 0) log("scope_slice_stop_failed", { slice, code: code ?? -1 });
  };

  return { scopeFor, kill, stopSlice };
};
