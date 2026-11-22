// The one service (per runtime dir) serves every workspace: the app starts it when none runs and never restarts it to
// open a folder. On a service of this app's API version it hands over a version 1 settings file's workspaces once
// (prepare), and on a service that lists none it asks for a first folder. What a quit does to the service is
// decideQuit's (quit.ts). Every start, upgrade and stop runs through one queue, so two of them never race.
import type { AddWorkspaceRequest, Workspace } from "@wombat/shared/api";
import { discoveryPath, type DiscoveryFile } from "@wombat/shared/discovery";
import { usableFolder } from "@wombat/shared/folder";
import { addWorkspace, listWorkspaces } from "./service-client.ts";
import { answeringService, runningService, startService, stopService } from "./service-start.ts";
import type { RendererSettings } from "../shared/bridge.ts";
import {
  asVersion2,
  isV1,
  loadSettings,
  type PageMemory,
  rendererSettings,
  savePageSettings,
  saveSettings,
  saveSettingsV1,
  type Settings,
  type SettingsV1,
  upgradeSettings,
} from "./settings.ts";

export type WorkspaceDeps = {
  env: NodeJS.ProcessEnv;
  settingsFile: string;
  /** The service's entry file. */
  serviceEntry: string;
  /** The workspace folder picker; undefined when it's cancelled. */
  chooseFolder: () => Promise<string | undefined>;
  /** Whether the service takes `at` as a folder (usableFolder); the upgrade leaves out the settings' folders it wouldn't. */
  usable?: (at: string) => boolean;
  log?: (line: string) => void;
  /** How long a running service gets to answer /version before it counts as not answering; the default when absent. */
  versionTimeoutMs?: number;
};

export type OpenedService = {
  /** Settles once the service runs; rejects with a ServiceStartFailed saying what to do. */
  service: Promise<DiscoveryFile>;
  /** The service the open found running and kept, if it did (rather than starting one). */
  found?: DiscoveryFile;
};

export type WorkspaceControl = {
  /** Finds the running service, or starts one when none runs. */
  open: () => Promise<OpenedService>;
  /**
   * Starts the service again if none runs (after it stopped or crashed). Rejects, naming its pid, when ours runs but
   * doesn't answer (answeringService).
   */
  restart: () => Promise<DiscoveryFile>;
  /**
   * For a service of this app's API version, before the app connects to it: adds a version 1 settings file's
   * workspaces (upgradeSettings) and saves the file as version 2; a failed add, or an open workspace whose folder is
   * gone (missingCurrent), is logged and leaves the file at version 1 for the next start. Then, once per launch, asks for a first workspace when the service lists none.
   */
  prepare: (file: DiscoveryFile) => Promise<void>;
  /**
   * Stops the running service (runningService) and its agents (POST /shutdown, then its exit); nothing to do when none
   * runs. Rejects with a ServiceStartFailed, naming its pid and how to stop it, when the service's process runs but
   * doesn't stop: a quit must not leave it behind as if stopped.
   */
  shutdown: () => Promise<void>;
  /** Settles once every start, upgrade and shutdown asked for so far has. */
  idle: () => Promise<void>;
  settings: () => Settings;
  /** Saves `change(current settings)` as version 2; the one way to change them while the control holds them. */
  updateSettings: (change: (current: Settings) => Settings) => void;
  /** The page's settings.get. */
  pageSettings: () => RendererSettings;
  /** The page's settings.set. */
  setPageSettings: (patch: unknown) => void;
};

/** The folder picker, then `add` with the chosen folder: the added workspace's id, or undefined when it's cancelled. */
export const addChosenWorkspace = async (
  pick: () => Promise<string | undefined>,
  add: (request: AddWorkspaceRequest) => Promise<Workspace>,
): Promise<string | undefined> => {
  const root = await pick();
  return root === undefined ? undefined : (await add({ root })).id;
};

export const workspaceControl = ({
  env,
  settingsFile,
  serviceEntry,
  chooseFolder,
  usable = usableFolder,
  log = console.warn,
  versionTimeoutMs,
}: WorkspaceDeps): WorkspaceControl => {
  const loaded = loadSettings(settingsFile, log);
  let settings: Settings = isV1(loaded) ? asVersion2(loaded) : loaded;
  // A version 1 file whose workspaces the service doesn't have yet; undefined once they're handed over.
  let pending: SettingsV1 | undefined = isV1(loaded) ? loaded : undefined;
  // The page's own settings that version 2 doesn't save; a version 1 file's are dropped with it.
  let memory: PageMemory = {};
  /** Writes `next`: as version 1 with the workspaces still to hand over, or as version 2. */
  const write = (next: Settings) => (pending === undefined ? saveSettings(settingsFile, next) : saveSettingsV1(settingsFile, pending, next));
  // Saved first: a save that fails leaves the settings in memory as they are in the file.
  const updateSettings = (change: (current: Settings) => Settings) => {
    const next = change(settings);
    write(next);
    settings = next;
  };
  // Rejects when ours runs but doesn't answer: nothing then starts a second service next to it.
  const findRunning = () => answeringService(discoveryPath(env), versionTimeoutMs);

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  /** The running service, started if none runs. */
  const ensure = (): Promise<DiscoveryFile> =>
    enqueue(async () => (await findRunning()) ?? startService({ env, entry: serviceEntry }));

  const upgrade = (file: DiscoveryFile): Promise<void> =>
    enqueue(async () => {
      if (pending === undefined) return;
      const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
      let waitingFor: string | undefined;
      try {
        waitingFor = await upgradeSettings(pending, (request) => addWorkspace(file, request), usable);
      } catch (error) {
        log(`Wombat couldn't hand the workspaces in settings.json to the service, so the file stays at version 1 and the next start tries again: ${reason(error)}`);
        return;
      }
      if (waitingFor !== undefined) {
        log(
          `The workspace folder ${waitingFor}, open when Wombat last ran, is gone or can't be read, so its agents and proposals from before aren't listed yet. ` +
            "settings.json stays at version 1: restore the folder (or make it readable) and start Wombat again to list them.",
        );
        return;
      }
      try {
        // The settings as they are now: a change saved meanwhile is kept.
        saveSettings(settingsFile, settings);
        pending = undefined;
      } catch (error) {
        log(
          `Wombat handed the workspaces in settings.json to the service but couldn't rewrite the file as version 2, so it stays at version 1 and the next start hands them over again (nothing changes twice): ${reason(error)}`,
        );
      }
    });

  let askedFirst = false;
  const prepare = async (file: DiscoveryFile): Promise<void> => {
    await upgrade(file);
    if (askedFirst) return;
    askedFirst = true;
    try {
      if ((await listWorkspaces(file)).length > 0) return;
      await addChosenWorkspace(chooseFolder, (request) => addWorkspace(file, request));
    } catch (error) {
      log(`Wombat couldn't add the first workspace: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const shutdown = (): Promise<void> =>
    enqueue(async () => {
      const running = runningService(discoveryPath(env));
      if (running !== undefined) await stopService(running.file);
    });

  const open = async (): Promise<OpenedService> => {
    let running: DiscoveryFile | undefined;
    try {
      running = await findRunning();
    } catch (error) {
      // Shown as the connection's `failed` state, with its message, as a start that fails is.
      return { service: Promise.reject(error instanceof Error ? error : new Error(String(error))) };
    }
    if (running === undefined) return { service: ensure() };
    return { service: Promise.resolve(running), found: running };
  };

  return {
    open,
    restart: ensure,
    prepare,
    shutdown,
    idle: () => queue.then(() => undefined),
    settings: () => settings,
    updateSettings,
    pageSettings: () => rendererSettings(settings, memory),
    setPageSettings: (patch) => {
      memory = savePageSettings(updateSettings, memory, patch);
    },
  };
};
