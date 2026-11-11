import { API_VERSION } from "@wombat/shared";
import type { Alert } from "@wombat/shared/api";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type ConnectionUpdate, type Unsubscribe, type WombatBridge } from "../shared/bridge.ts";
import { connectionFeed } from "./connection-feed.ts";

// The page's only bridge to the host. Everything added here widens what a page can reach;
// keep it in step with the allow-lists in e2e/trust-boundary.e2e.ts.

const subscribe = <T>(channel: string, cb: (value: T) => void): Unsubscribe => {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
};

// Kept from load on, so a page that subscribes late still gets the current state at once.
const connection = connectionFeed();
ipcRenderer.on(CHANNELS.connection, (_event, update: ConnectionUpdate) => connection.take(update));
ipcRenderer
  .invoke(CHANNELS.connectionNow)
  .then((update: ConnectionUpdate) => connection.take(update))
  .catch((error: unknown) => {
    // The pushed states still arrive; only the one before the first push is missing.
    console.error("Wombat couldn't read the service connection's state:", error);
  });

const bridge: WombatBridge = {
  apiVersion: API_VERSION,
  service: {
    request: (method, path, body) => ipcRenderer.invoke(CHANNELS.request, method, path, body),
    onAlert: (cb) => subscribe<Alert>(CHANNELS.alert, cb),
    onConnection: (cb) => connection.subscribe(cb),
    restart: () => ipcRenderer.invoke(CHANNELS.restart),
  },
  workspace: {
    get: () => ipcRenderer.invoke(CHANNELS.workspaceGet),
    switch: () => ipcRenderer.invoke(CHANNELS.workspaceSwitch),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
  },
  onOpenAgent: (cb) => subscribe<string>(CHANNELS.openAgent, cb),
};

contextBridge.exposeInMainWorld("wombat", bridge);
