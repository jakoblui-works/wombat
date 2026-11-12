// Starting and stopping the agent service from the app. The service outlives the app (it keeps the agents running),
// so it's started detached with its output in a log file, and the app finds it the way every client does: through
// the discovery file and its token.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";
import { SERVICE_ENV } from "@wombat/shared";
import { discoveryPath, findRunningService, HOLDER_WAIT_MS, readDiscovery, type DiscoveryFile } from "@wombat/shared/discovery";
import { ensurePrivateFile } from "@wombat/shared/private-file";
import { isAlive, startTimeOf } from "@wombat/shared/process-stat";
import { stateDir } from "@wombat/shared/state-dir";
import { callService } from "./service-client.ts";

const POLL_MS = 100;
/** A start's own time, plus the wait of a start that finds another one holding the lock. */
const START_TIMEOUT_MS = 15_000 + HOLDER_WAIT_MS;
/** POST /shutdown answers once the agents have stopped, which can take tens of seconds. */
const SHUTDOWN_TIMEOUT_MS = 120_000;
/** After its 202 the service only closes its store and lock. */
const EXIT_TIMEOUT_MS = 30_000;

/** A start or stop that failed; the message says what to do and names the service's log. */
/** The app's service as its discovery file names it, with the process that is it. */
export type RunningService = { file: DiscoveryFile; pid: number };

/**
 * The service the discovery file at `path` names, when its process still runs: the pid alive and started when the file
 * says (`processStart`), so a pid reused by another process after a crash isn't taken for it. A file without
 * `processStart`, from an older service, is taken at its pid alone. Undefined when there's no file or its process is
 * gone; a leftover file is ignored (a start replaces it). The one place that decides whether the app's service runs.
 */
export const runningService = (path: string): RunningService | undefined => {
  const file = readDiscovery(path);
  if (file === undefined) return undefined;
  const start = startTimeOf(file.pid);
  if (start === undefined || (file.processStart !== undefined && start !== file.processStart)) return undefined;
  return { file, pid: file.pid };
};

export class ServiceStartFailed extends Error {
  /** Paths in the message that lie outside the workspace, which the page never sees (see pageMessage). */
  readonly privatePaths: readonly string[];

  constructor(message: string, privatePaths: readonly (string | undefined)[] = []) {
    super(message);
    this.privatePaths = privatePaths.filter((at) => at !== undefined);
  }
}

/** A start failure's message for the page: its private paths cut to their last part, and nothing of other errors. */
export const pageMessage = (error: unknown): string => {
  if (!(error instanceof ServiceStartFailed)) {
    return "Wombat couldn't start the service. Restart to try again; if it fails again, start Wombat from a terminal to see why.";
  }
  return error.privatePaths.reduce((message, at) => message.replaceAll(at, `…/${path.basename(at)}`), error.message);
};

/**
 * A running service from before this app: its discovery file doesn't name its workspace. The connection shows it as
 * `incompatible`, with Restart.
 */
export class ServiceTooOld extends ServiceStartFailed {
  constructor(running: DiscoveryFile) {
    super(
      `The running service (pid ${String(running.pid)}) predates this app: it doesn't say which workspace it runs for. ` +
        `Stop it yourself (\`kill ${String(running.pid)}\`; its agents stop with it), then press Restart to start this app's own service.`,
    );
  }
}

/** `running` when it's a service of this app (it names its workspace); throws ServiceTooOld when it predates the app. */
export const ofThisApp = (running: DiscoveryFile): DiscoveryFile => {
  if (running.workspace === undefined) throw new ServiceTooOld(running);
  return running;
};

/**
 * The failure for a running service that isn't for `workspace`: the app never takes it for that workspace's. One
 * that names no workspace predates the app (ServiceTooOld).
 */
export const otherWorkspaceFailure = (running: DiscoveryFile, workspace: string): ServiceStartFailed => {
  if (running.workspace === undefined) return new ServiceTooOld(running);
  return new ServiceStartFailed(
    `The running service is for another workspace (${running.workspace}), not ${workspace}. Switch to ${workspace} again to restart the service for it.`,
    [running.workspace],
  );
};

/** The service's log, in Wombat's state folder; throws when there's no state folder. */
export const serviceLogPath = (env: NodeJS.ProcessEnv): string => path.join(stateDir(env), "service.log");

/** Opens the log for appending; it's private (it may hold paths and agent errors). */
const openLog = (file: string): number => {
  ensurePrivateFile(file);
  return openSync(file, "a");
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
  const out: NodeJS.ProcessEnv = { ...env, [SERVICE_ENV.workspace]: workspace };
  delete out[SERVICE_ENV.items];
  if (itemsRoot !== undefined) out[SERVICE_ENV.items] = itemsRoot;
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
      `The service's entry ${entry} is missing. The app runs the service from its source, app/service/src in the Wombat repo: ` +
        "restore that folder (`git status` in the repo shows what's gone) and start Wombat again.",
      [entry],
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
        [logPath],
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
    if (found !== undefined && found.workspace !== workspace) throw otherWorkspaceFailure(found, workspace);
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new ServiceStartFailed(
        `The service didn't start within ${String(Math.round(timeoutMs / 1000))} s. Its log ${logPath} says why; fix that and start Wombat again.`,
        [logPath],
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
  while (isAlive(file.pid)) {
    if (Date.now() > deadline) {
      throw new ServiceStartFailed(
        `The service (pid ${String(file.pid)}) stopped its agents but hasn't exited. Stop it yourself (\`kill ${String(file.pid)}\`) and try again.`,
      );
    }
    await delay(POLL_MS);
  }
};
