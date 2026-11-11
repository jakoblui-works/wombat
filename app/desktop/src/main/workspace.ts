// One workspace at a time: the settings name it, and the one service (per runtime dir) runs for it. The app starts
// the service when none runs and leaves it running when it quits. Every start, switch and restart runs through one
// queue, so two of them never race to start services for different workspaces.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { discoveryPath, findRunningService, type DiscoveryFile } from "@wombat/shared/discovery";
import { runningCount } from "./quit.ts";
import { listAgents } from "./service-client.ts";
import { otherWorkspaceFailure, ServiceStartFailed, startService, stopService } from "./service-start.ts";
import type { RendererSettings } from "../shared/bridge.ts";
import { loadSettings, rendererSettings, savePageSettings, saveSettings, type Settings } from "./settings.ts";

export type WorkspaceDeps = {
  env: NodeJS.ProcessEnv;
  settingsFile: string;
  /** The service's entry file. */
  serviceEntry: string;
  /** The workspace folder dialog; undefined when it's cancelled. */
  chooseFolder: () => Promise<string | undefined>;
  /**
   * "Restart the service for <workspace>? Its agents stop."; true for Restart. `running` is how many of its agents
   * run, undefined when they couldn't be read.
   */
  confirmRestart: (workspace: string, running: number | undefined) => Promise<boolean>;
  log?: (line: string) => void;
};

export type OpenedWorkspace = {
  workspace: string;
  /** Settles once the workspace's service runs; rejects with a ServiceStartFailed saying what to do. */
  service: Promise<DiscoveryFile>;
};

export type WorkspaceControl = {
  /** Picks the workspace (asking on first start) and starts its service if needed; undefined when the user cancelled. */
  open: () => Promise<OpenedWorkspace | undefined>;
  /**
   * Whether a switch to `workspace` may go ahead: asks first (confirmRestart) when it would stop a running service
   * for another workspace; true without asking when none runs or the running one is for `workspace`.
   */
  confirmSwitch: (workspace: string) => Promise<boolean>;
  /**
   * Stops a service running for another workspace, starts one for `workspace`, then saves it as the workspace. It
   * doesn't ask: confirmSwitch does, before it.
   */
  switchWorkspace: (workspace: string) => Promise<DiscoveryFile>;
  /** Starts the service for the saved workspace again if none runs (after it stopped or crashed). */
  restart: () => Promise<DiscoveryFile>;
  /** Stops the running service and its agents (POST /shutdown, then its exit), whichever workspace it's for. */
  shutdown: () => Promise<void>;
  /** Settles once every start, switch, restart and shutdown asked for so far has. */
  idle: () => Promise<void>;
  settings: () => Settings;
  /** Saves `change(current settings)`; the one way to change them while the control holds them. */
  updateSettings: (change: (current: Settings) => Settings) => void;
  /** The page's settings.get. The first one after a switch is the reloaded page's: it lets layouts save again. */
  pageSettings: () => RendererSettings;
  /**
   * The page's settings.set. From the start of a switch until the reloaded page reads its settings, the layout in a
   * patch is dropped: it's the old workspace's, and once the switch saves the new workspace it would land there.
   */
  setPageSettings: (patch: unknown) => void;
};

export const workspaceControl = ({
  env,
  settingsFile,
  serviceEntry,
  chooseFolder,
  confirmRestart,
  log = console.warn,
}: WorkspaceDeps): WorkspaceControl => {
  let settings = loadSettings(settingsFile, log);
  // Saved first: a save that fails leaves the settings in memory as they are in the file.
  const updateSettings = (change: (current: Settings) => Settings) => {
    const next = change(settings);
    saveSettings(settingsFile, next);
    settings = next;
  };
  const save = (patch: Partial<Settings>) => updateSettings((current) => ({ ...current, ...patch }));
  const findRunning = () => findRunningService(discoveryPath(env));
  const startFor = (workspace: string) =>
    startService({ env, entry: serviceEntry, workspace, itemsRoot: settings.workspaces[workspace]?.itemsRoot });

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  /** The running service for `workspace`, started if none runs; a service for another workspace is left alone. */
  const ensure = (workspace: string): Promise<DiscoveryFile> =>
    enqueue(async () => {
      const running = await findRunning();
      if (running === undefined) return startFor(workspace);
      if (running.workspace === workspace) return running;
      throw otherWorkspaceFailure(running, workspace);
    });

  let layoutFrozen = false;

  const switchWorkspace = (workspace: string): Promise<DiscoveryFile> => {
    // At once, not in the queue: a layout save may already be on its way.
    layoutFrozen = true;
    const switched = enqueue(async () => {
      let file = await findRunning();
      if (file?.workspace !== workspace) {
        if (file !== undefined) await stopService(file);
        file = await startFor(workspace);
      }
      save({ workspace });
      return file;
    });
    // A switch that failed reloads nothing: the page still shows the saved workspace, and saves its layout again.
    switched.catch(() => {
      layoutFrozen = false;
    });
    return switched;
  };

  const idle = () => queue.then(() => undefined);

  /** The restart question about `running`, with how many of its agents run. */
  const askRestart = async (running: DiscoveryFile, workspace: string): Promise<boolean> =>
    confirmRestart(workspace, await runningCount(() => listAgents(running), log));

  const confirmSwitch = async (workspace: string): Promise<boolean> => {
    // After any start in flight, so the question is about the service that will be stopped.
    await idle();
    const running = await findRunning();
    return running === undefined || running.workspace === workspace || askRestart(running, workspace);
  };

  const restart = (): Promise<DiscoveryFile> => {
    const { workspace } = settings;
    if (workspace === undefined) return Promise.reject(new ServiceStartFailed("No workspace is chosen yet. Choose one with Switch Workspace."));
    return ensure(workspace);
  };

  const shutdown = (): Promise<void> =>
    enqueue(async () => {
      const file = await findRunning();
      if (file !== undefined) await stopService(file);
    });

  const open = async (): Promise<OpenedWorkspace | undefined> => {
    let workspace = settings.workspace;
    if (workspace === undefined) {
      workspace = await chooseFolder();
      if (workspace === undefined) return undefined;
      save({ workspace });
    }
    const running = await findRunning();
    if (running === undefined) return { workspace, service: ensure(workspace) };
    if (running.workspace === workspace) return { workspace, service: Promise.resolve(running) };
    if (await askRestart(running, workspace)) return { workspace, service: switchWorkspace(workspace) };
    // Kept: the running service and its agents. A service that doesn't name its workspace leaves the settings as they are.
    if (running.workspace === undefined) return { workspace, service: Promise.resolve(running) };
    save({ workspace: running.workspace });
    return { workspace: running.workspace, service: Promise.resolve(running) };
  };

  return {
    open,
    confirmSwitch,
    switchWorkspace,
    restart,
    shutdown,
    idle,
    settings: () => settings,
    updateSettings,
    pageSettings: () => {
      layoutFrozen = false;
      return rendererSettings(settings);
    },
    setPageSettings: (patch) => savePageSettings(updateSettings, patch, undefined, !layoutFrozen),
  };
};

/** The names of `root`'s immediate subfolders that are git repos (a `.git` folder, or file in a worktree), sorted. */
export const workspaceRepos = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort();
};
