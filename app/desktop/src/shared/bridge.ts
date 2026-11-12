// What the preload exposes as `window.wombat`, and the IPC channels behind it. The page reaches the service only
// through this bridge: main holds the token and checks every call (e2e/trust-boundary.e2e.ts checks the names).
import type { API_VERSION } from "@wombat/shared";
import type { Alert } from "@wombat/shared/api";

export type ConnectionState = {
  state: "connecting" | "connected" | "reconnecting" | "incompatible" | "failed";
  message?: string;
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

export type WombatBridge = {
  readonly apiVersion: typeof API_VERSION;
  readonly service: {
    /** Rejects, without reaching the service, a method and path outside APP_ROUTES or a body over MAX_BODY_BYTES. */
    request: (method: string, path: string, body?: unknown) => Promise<ServiceAnswer>;
    onAlert: (cb: (alert: Alert) => void) => Unsubscribe;
    /** Calls `cb` with the current state at once, then with every change. */
    onConnection: (cb: (state: ConnectionState) => void) => Unsubscribe;
    /**
     * By the connection's state:
     * - `failed`, `connecting`, `reconnecting`, `connected`: starts the service for the workspace if none runs (a
     *   running one for it is kept, with its agents), then connects again. A running service for another workspace
     *   is never taken: the state turns `failed`, saying to switch.
     * - `incompatible`: asks "Stop the service and its N agents?" first; Stop stops the running service and its
     *   agents and starts this app's own, Cancel leaves everything as it is.
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
} as const;
