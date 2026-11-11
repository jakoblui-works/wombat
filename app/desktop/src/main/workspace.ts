// One workspace at a time: the settings name it, and the one service (per runtime dir) runs for it. The app starts
// the service when none runs and leaves it running when it quits. Every start, switch and restart runs through one
// queue, so two of them never race to start services for different workspaces.
import { discoveryPath, findRunningService, type DiscoveryFile } from "@wombat/shared/discovery";
import { ServiceStartFailed, startService, stopService } from "./service-start.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";

export type WorkspaceDeps = {
  env: NodeJS.ProcessEnv;
  settingsFile: string;
  /** The service's entry file. */
  serviceEntry: string;
  /** The workspace folder dialog; undefined when it's cancelled. */
  chooseFolder: () => Promise<string | undefined>;
  /** "Restart the service for <workspace>? Its agents stop."; true for Restart. */
  confirmRestart: (workspace: string) => Promise<boolean>;
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
  /** Stops a service running for another workspace, starts one for `workspace`, then saves it as the workspace. */
  switchWorkspace: (workspace: string) => Promise<DiscoveryFile>;
  /** Starts the service for the saved workspace again if none runs (after it stopped or crashed). */
  restart: () => Promise<DiscoveryFile>;
  settings: () => Settings;
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
  const save = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settingsFile, settings);
  };
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
      throw new ServiceStartFailed(
        `The running service is for another workspace (${running.workspace ?? "one it doesn't name"}), not ${workspace}. ` +
          `Switch to ${workspace} again to restart the service for it.`,
      );
    });

  const switchWorkspace = (workspace: string): Promise<DiscoveryFile> =>
    enqueue(async () => {
      let file = await findRunning();
      if (file?.workspace !== workspace) {
        if (file !== undefined) await stopService(file);
        file = await startFor(workspace);
      }
      save({ workspace });
      return file;
    });

  const restart = (): Promise<DiscoveryFile> => {
    const { workspace } = settings;
    if (workspace === undefined) return Promise.reject(new ServiceStartFailed("No workspace is chosen yet. Choose one with Switch Workspace."));
    return ensure(workspace);
  };

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
    if (await confirmRestart(workspace)) return { workspace, service: switchWorkspace(workspace) };
    // Kept: the running service and its agents. A service that doesn't name its workspace leaves the settings as they are.
    if (running.workspace === undefined) return { workspace, service: Promise.resolve(running) };
    save({ workspace: running.workspace });
    return { workspace: running.workspace, service: Promise.resolve(running) };
  };

  return { open, switchWorkspace, restart, settings: () => settings };
};
