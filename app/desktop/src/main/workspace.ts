// One workspace at a time: the settings name it, and the one service (per runtime dir) runs for it. The app starts
// the service when none runs; what a quit does to it is decideQuit's (quit.ts). Every start, switch and restart runs
// through one queue, so two of them never race to start services for different workspaces.
import { discoveryPath, type DiscoveryFile } from "@wombat/shared/discovery";
import { runningCount } from "./quit.ts";
import { listAgents } from "./service-client.ts";
import { answeringService, otherWorkspaceFailure, runningService, ServiceStartFailed, startService, stopService } from "./service-start.ts";
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
  /** The service the open found running and kept, if it did (rather than starting one). */
  found?: DiscoveryFile;
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
  /**
   * Starts the service for the saved workspace again if none runs (after it stopped or crashed). Rejects, naming its
   * pid, when ours runs but doesn't answer (answeringService).
   */
  restart: () => Promise<DiscoveryFile>;
  /**
   * Stops the running service (runningService) and its agents (POST /shutdown, then its exit), whichever workspace
   * it's for; nothing to do when none runs. Rejects with a ServiceStartFailed, naming its pid and how to stop it, when
   * the service's process runs but doesn't stop: a quit must not leave it behind as if stopped.
   */
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
  // Rejects when ours runs but doesn't answer: nothing then starts a second service next to it.
  const findRunning = () => answeringService(discoveryPath(env));
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
      const running = runningService(discoveryPath(env));
      if (running !== undefined) await stopService(running.file);
    });

  const open = async (): Promise<OpenedWorkspace | undefined> => {
    let workspace = settings.workspace;
    if (workspace === undefined) {
      workspace = await chooseFolder();
      if (workspace === undefined) return undefined;
      save({ workspace });
    }
    let running: DiscoveryFile | undefined;
    try {
      running = await findRunning();
    } catch (error) {
      // Shown as the connection's `failed` state, with its message, as a start that fails is.
      return { workspace, service: Promise.reject(error instanceof Error ? error : new Error(String(error))) };
    }
    if (running === undefined) return { workspace, service: ensure(workspace) };
    const found = { service: Promise.resolve(running), found: running };
    if (running.workspace === workspace) return { workspace, ...found };
    if (await askRestart(running, workspace)) return { workspace, service: switchWorkspace(workspace) };
    // Kept: the running service and its agents. A service that doesn't name its workspace leaves the settings as they are;
    // it predates this app, so the connection then shows it as incompatible (ofThisApp).
    if (running.workspace === undefined) return { workspace, ...found };
    save({ workspace: running.workspace });
    return { workspace: running.workspace, ...found };
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
