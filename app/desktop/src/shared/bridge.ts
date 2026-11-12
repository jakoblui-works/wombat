// What the preload exposes as `window.wombat`, and the IPC channels behind it. The page reaches the service only
// through this bridge: main holds the token and checks every call (e2e/trust-boundary.e2e.ts checks the names).
import type { API_VERSION } from "@wombat/shared";
import type { Alert } from "@wombat/shared/api";

export type ConnectionState = {
  state: "connecting" | "connected" | "reconnecting" | "incompatible" | "failed";
  message?: string;
  /**
   * Set only while `connected`, once the service's GET /version has answered: when it started (absent from a service
   * from before it was reported) and whether it runs other code than the app would start (`stale`). Absent while
   * unknown (not yet read, or /version failed).
   */
  service?: { startedAt?: string; stale: boolean };
};

/** The service's answer: its status, and its body parsed as JSON (undefined when empty). */
export type ServiceAnswer = { status: number; body: unknown };

/**
 * The settings the page reads and writes; `layout` is the current workspace's. Main's patch schema must match it
 * (RENDERER_PATCH_MATCHES in main/settings.ts fails to compile otherwise).
 */
export type RendererSettings = { askOnQuit: boolean; lastAgentFolder?: string; layout?: unknown };

/** The workspace root. Its repos are the service's to list (GET /repos). */
export type WorkspaceInfo = { root: string };

export type Unsubscribe = () => void;

/**
 * The commands the page may ask main to run: the ones only main can do (zoom, the window, the clipboard through
 * webContents, the workspace and service dialogs, quitting). Main runs an id only when isMainCommandId takes it, so
 * this list is the whole of what `command` can reach; the trust-boundary e2e checks the rest are refused.
 */
export const MAIN_COMMAND_IDS = [
  "zoom.in",
  "zoom.out",
  "zoom.reset",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
  "window.minimize",
  "window.maximize",
  "window.close",
  "workspace.switch",
  "service.stop",
  "app.quit",
] as const;

export type MainCommandId = (typeof MAIN_COMMAND_IDS)[number];

const MAIN_COMMANDS: ReadonlySet<unknown> = new Set(MAIN_COMMAND_IDS);

/** Whether `id` is one of MAIN_COMMAND_IDS itself: a Set lookup, so nothing that only coerces to one passes. */
export const isMainCommandId = (id: unknown): id is MainCommandId => MAIN_COMMANDS.has(id);

export type WombatBridge = {
  readonly apiVersion: typeof API_VERSION;
  readonly service: {
    /** Rejects, without reaching the service, a method and path outside APP_ROUTES or a body over MAX_BODY_BYTES. */
    request: (method: string, path: string, body?: unknown) => Promise<ServiceAnswer>;
    onAlert: (cb: (alert: Alert) => void) => Unsubscribe;
    /** Calls `cb` with the current state at once, then with every change. */
    onConnection: (cb: (state: ConnectionState) => void) => Unsubscribe;
    /**
     * Whatever the connection's state: when agents have a process, asks "Stop the service and its N agents?" first (Cancel leaves
     * everything as it is); then stops the running service, if any, and starts one from the code on disk for the
     * workspace (a running service for another workspace is stopped too), then connects to it.
     * Settles once the service is connected, incompatible or failed (or the question was cancelled).
     */
    restart: () => Promise<void>;
  };
  readonly workspace: {
    get: () => Promise<WorkspaceInfo>;
    /**
     * Opens the folder picker, then switches the service to the chosen workspace, asking first when that stops a
     * running service ("Restart the service for <workspace>?"; Cancel changes nothing). A switch that goes ahead
     * reloads the page, so it reads the new workspace's settings and layout afresh.
     */
    switch: () => Promise<void>;
  };
  readonly settings: {
    get: () => Promise<RendererSettings>;
    set: (patch: Partial<RendererSettings>) => Promise<void>;
  };
  onOpenAgent: (cb: (agentId: string) => void) => Unsubscribe;
  /** Runs a main command; rejects, running nothing, for an id outside MAIN_COMMAND_IDS. */
  command: (id: MainCommandId) => Promise<void>;
  /** Calls `cb` with the app's zoom level (an Electron zoom level, 0 is 100%) after each change is applied. */
  onZoom: (cb: (level: number) => void) => Unsubscribe;
};

/** A connection state as main sends it: `seq` orders the states, so a late answer never replaces a newer state. */
export type ConnectionUpdate = { seq: number; state: ConnectionState };

export const CHANNELS = {
  request: "wombat:service:request",
  restart: "wombat:service:restart",
  alert: "wombat:service:alert",
  connection: "wombat:service:connection",
  connectionNow: "wombat:service:connection-now",
  workspaceGet: "wombat:workspace:get",
  workspaceSwitch: "wombat:workspace:switch",
  settingsGet: "wombat:settings:get",
  settingsSet: "wombat:settings:set",
  openAgent: "wombat:open-agent",
  command: "wombat:command",
  zoom: "wombat:zoom",
} as const;
