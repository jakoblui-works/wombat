// Starting and stopping the agent service from the app. The service outlives the app (it keeps the agents running),
// so it's started detached with its output in a log file, and the app finds it the way every client does: through
// the discovery file and its token.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { discoveryPath, findRunningService, type DiscoveryFile } from "@wombat/shared/discovery";
import { ensurePrivateFile } from "@wombat/shared/private-file";
import { stateDir } from "@wombat/shared/state-dir";
import { callService } from "./service-client.ts";

const POLL_MS = 100;
/** Covers a start that first waits (up to 5 s) for another start holding the lock. */
const START_TIMEOUT_MS = 20_000;
/** POST /shutdown answers once the agents have stopped, which can take tens of seconds. */
const SHUTDOWN_TIMEOUT_MS = 120_000;
/** After its 202 the service only closes its store and lock. */
const EXIT_TIMEOUT_MS = 30_000;

/** A start or stop that failed; the message says what to do and names the service's log. */
export class ServiceStartFailed extends Error {}

/** The service's log, in Wombat's state folder; throws when there's no state folder. */
export const serviceLogPath = (env: NodeJS.ProcessEnv): string => path.join(stateDir(env), "service.log");

/** Opens the log for appending; it's private (it may hold paths and agent errors). */
const openLog = (file: string): number => {
  ensurePrivateFile(file);
  return openSync(file, "a");
};

/** False once `pid` has exited (a zombie counts as exited: only its parent hasn't collected it yet). */
export const isRunning = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return false;
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type StartOptions = {
  /** The service's env: XDG dirs and anything else it reads come from here, passed through unchanged. */
  env: NodeJS.ProcessEnv;
  /** The service's entry file, run with `node` from the env's PATH. */
  entry: string;
  workspace: string;
  itemsRoot?: string | undefined;
  timeoutMs?: number;
};

/** The service's env: the app's own, with the workspace and items root from the settings. */
const serviceEnv = (env: NodeJS.ProcessEnv, workspace: string, itemsRoot: string | undefined): NodeJS.ProcessEnv => {
  // The settings own the items root: an inherited one may belong to another workspace.
  const out: NodeJS.ProcessEnv = { ...env, WOMBAT_WORKSPACE: workspace };
  delete out["WOMBAT_ITEMS"];
  if (itemsRoot !== undefined) out["WOMBAT_ITEMS"] = itemsRoot;
  return out;
};

/**
 * Starts the service for `workspace` and resolves with its discovery file once `findRunningService` accepts it. A
 * start that finds another service holding the lock exits 0; the one it found is returned if it's for `workspace`,
 * and is a failure if not (the app must never take another workspace's service for this one).
 */
export const startService = async ({
  env,
  entry,
  workspace,
  itemsRoot,
  timeoutMs = START_TIMEOUT_MS,
}: StartOptions): Promise<DiscoveryFile> => {
  if (!existsSync(entry)) {
    throw new ServiceStartFailed(
      `The service's entry ${entry} is missing. Rebuild the app (\`pnpm --filter @wombat/desktop build\` in app/) and start it again.`,
    );
  }
  const logPath = serviceLogPath(env);
  const discovery = discoveryPath(env);
  const fd = openLog(logPath);
  let failure: ServiceStartFailed | undefined;
  try {
    const child = spawn("node", [entry], {
      env: serviceEnv(env, workspace, itemsRoot),
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.once("error", (error) => {
      failure = new ServiceStartFailed(
        `Wombat couldn't run \`node\` to start the service (${error.message}). Install Node.js 26 or later, make sure \`node\` is on PATH, and start Wombat again.`,
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) return;
      failure ??= new ServiceStartFailed(
        `The service stopped while starting (${signal ?? `exit code ${String(code)}`}). Its log ${logPath} says why; fix that and start Wombat again.`,
      );
    });
    child.unref();
  } finally {
    closeSync(fd);
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (failure !== undefined) throw failure;
    const found = await findRunningService(discovery);
    if (found !== undefined && found.workspace !== workspace) {
      throw new ServiceStartFailed(
        `A service for another workspace (${found.workspace ?? "one it doesn't name"}) started while Wombat was starting one for ${workspace}. ` +
          `Switch to ${workspace} again to restart the service for it.`,
      );
    }
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new ServiceStartFailed(
        `The service didn't start within ${String(Math.round(timeoutMs / 1000))} s. Its log ${logPath} says why; fix that and start Wombat again.`,
      );
    }
    await delay(POLL_MS);
  }
};

/** Asks the service to stop (POST /shutdown), waits for its 202 (its agents have stopped), then for its process to exit. */
export const stopService = async (file: DiscoveryFile): Promise<void> => {
  let status: number;
  try {
    const response = await callService(file, "POST", "/shutdown", { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    await response.body?.cancel();
    status = response.status;
  } catch (error) {
    throw new ServiceStartFailed(
      `Wombat couldn't ask the service (pid ${String(file.pid)}) to stop: ${(error as Error).message}. Stop it yourself (\`kill ${String(file.pid)}\`) and try again.`,
    );
  }
  if (status !== 202) {
    throw new ServiceStartFailed(
      `The service (pid ${String(file.pid)}) refused to stop (HTTP ${String(status)}). Stop it yourself (\`kill ${String(file.pid)}\`) and try again.`,
    );
  }
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (isRunning(file.pid)) {
    if (Date.now() > deadline) {
      throw new ServiceStartFailed(
        `The service (pid ${String(file.pid)}) stopped its agents but hasn't exited. Stop it yourself (\`kill ${String(file.pid)}\`) and try again.`,
      );
    }
    await delay(POLL_MS);
  }
};
