import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { codeIdOf } from "@wombat/shared/code-id";
import { agentCountLabel } from "@wombat/shared/api";
import { discoveryPath, type DiscoveryFile } from "@wombat/shared/discovery";
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, Menu, Notification, protocol, session, shell, type WebContents } from "electron";
import { CHANNELS, type ConnectionState, type WorkspaceInfo } from "../shared/bridge.ts";
import { APP_INDEX_URL, APP_SCHEME, contentType, isAppUrl, isBridgeSender, resolveAppFile } from "./app-protocol.ts";
import { mainCommands } from "./commands.ts";
import { readE2eSwitches, recordE2eNotification } from "./e2e-switches.ts";
import { noticeSink } from "./notice-sink.ts";
import { NONCE_PLACEHOLDER, newNonce, pageCsp, withNonce } from "./page-csp.ts";
import { decideQuit, restartService, stopIfConfirmed, type QuitChoice } from "./quit.ts";
import { keptNotice, quitChoice, quitQuestion } from "./quit-question.ts";
import { listAgents } from "./service-client.ts";
import { serviceConnection } from "./service-connection.ts";
import { ofThisApp, runningService } from "./service-start.ts";
import { titleBarOverlayAt } from "./title-bar.ts";
import { settingsPath } from "./settings.ts";
import { waitingNotices } from "./waiting-notice.ts";
import { workspaceControl } from "./workspace.ts";

// The app's trust boundary (design doc, "App trust boundary"): a sandboxed renderer with no
// Node, no permissions, no new windows, and no navigation away from the app's own page.

const preloadPath = path.join(import.meta.dirname, "../preload/index.cjs");
const rendererRoot = path.join(import.meta.dirname, "../renderer");
// From the built main (out/main) to the service's source, which `node` runs as is.
const serviceEntry = path.join(import.meta.dirname, "../../../service/src/main.ts");

const e2e = readE2eSwitches(process.env);

/** The entry the app starts the service from: the checkout whose code a service it starts runs. */
const serviceEntryInUse = e2e?.serviceEntry ?? serviceEntry;
/** That checkout's `app/` folder: the entry is `app/<package>/<folder>/<file>`. */
const serviceAppRoot = path.join(serviceEntryInUse, "..", "..", "..");

// Before anything reads userData (Chromium takes its profile from it at startup): `<appData>/Wombat`, whatever the
// package is called.
app.setName("Wombat");
app.setPath("userData", path.join(app.getPath("appData"), app.getName()));

// The dev server's URL, only in a development build (`electron-vite dev`): `import.meta.env.DEV`
// is replaced at build time, so the built app never reads ELECTRON_RENDERER_URL.
const devServerUrl = (): string | undefined =>
  import.meta.env.DEV ? process.env["ELECTRON_RENDERER_URL"] : undefined;


// https links go to the host's browser; nothing else leaves the app.
const openExternally = (url: string): void => {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== "https:") return;
  shell.openExternal(parsed.href).catch((error: unknown) => {
    // The scheme and host only: a link's path and query may carry what the page shouldn't leave in a log.
    console.error(`Couldn't open a link to ${parsed.protocol}//${parsed.host} in the browser: ${error instanceof Error ? error.message : String(error)}`);
  });
};

const guardNavigation = (event: Electron.Event<{ url: string }>): void => {
  if (isAppUrl(event.url, devServerUrl())) return;
  event.preventDefault();
  openExternally(event.url);
};

const lockDown = (contents: WebContents): void => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", guardNavigation);
  contents.on("will-frame-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
};

const indexFile = path.join(rendererRoot, "index.html");

// Every app:// response but the page gets this fixed policy: a worker (Monaco's) runs under its own response's
// policy, not the page's, so without one it could fetch anything.
const OTHER_CSP = "default-src 'self'; connect-src 'none'; object-src 'none'";

/** A response that isn't the page, with OTHER_CSP. */
const otherResponse = (body: ConstructorParameters<typeof Response>[0], init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(body, { ...init, headers: { ...init.headers, "content-security-policy": OTHER_CSP } });

// The page itself: a fresh nonce per response, in the CSP header and the csp-nonce meta.
const servePage = async (file: string): Promise<Response> => {
  const html = await readFile(file, "utf8");
  if (!html.includes(NONCE_PLACEHOLDER)) {
    return otherResponse(
      `index.html has no ${NONCE_PLACEHOLDER} placeholder for the page's CSP nonce; restore the csp-nonce meta in src/renderer/index.html and rebuild.`,
      { status: 500 },
    );
  }
  const nonce = newNonce();
  return new Response(withNonce(html, nonce), {
    headers: {
      "content-type": contentType(file),
      "x-content-type-options": "nosniff",
      "content-security-policy": pageCsp(nonce),
    },
  });
};

// Serves only regular files under out/renderer; everything else is a 404.
const serveRenderer = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return otherResponse("Method not allowed", { status: 405 });
  const file = await resolveAppFile(rendererRoot, request.url);
  if (file === null) return otherResponse("Not found", { status: 404 });
  if (file === (await realpath(indexFile))) return servePage(file);
  return otherResponse(await readFile(file), {
    headers: { "content-type": contentType(file), "x-content-type-options": "nosniff" },
  });
};

// Every permission is denied. Allow one deliberately when a feature needs it, and update the
// e2e permission check with it.
const denyPermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
};

// The window controls' overlay, or none: Chromium's headless platform (the e2e window) crashes the app at launch when
// a window has one. The one place that decides; main's commands re-apply it as the zoom changes.
const overlayAt = e2e === undefined ? titleBarOverlayAt : undefined;

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: "hidden",
    ...(overlayAt === undefined ? {} : { titleBarOverlay: overlayAt(commands.zoomLevel()) }),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  commands.watchWindow(window);
  // Under the e2e checks the window never shows.
  if (e2e === undefined) {
    window.once("ready-to-show", () => {
      window.show();
    });
  }
  const devUrl = devServerUrl();
  await window.loadURL(devUrl ?? APP_INDEX_URL);
};

// Load Node's fetch classes (Request/Response, which protocol.handle uses) now, at startup.
// Node loads them lazily on first use; when that first use is the first app:// request, a
// debugger evaluating code in this process at the same moment (Playwright's e2e harness does)
// can interrupt the half-done load and break it, and the page load fails with ERR_UNEXPECTED.
// (A check rather than a bare `Response;`, which the bundler would drop.)
if (typeof Response !== "function") {
  throw new TypeError("Node's fetch classes failed to load at startup; the app can't serve its pages. Reinstall the app's dependencies (`pnpm install` in app/) and rebuild.");
}

app.enableSandbox();
// `standard` gives APP_ORIGIN a real origin (so the CSP's 'self' and relative URLs work);
// no other privileges.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true } }]);

app.on("web-contents-created", (_event, contents) => {
  lockDown(contents);
});

app.on("window-all-closed", () => {
  app.quit();
});

const chooseFolder = async (): Promise<string | undefined> => {
  if (e2e !== undefined) return e2e.workspace;
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose the workspace folder (the folder that holds the project's repos)",
    buttonLabel: "Open Workspace",
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled ? undefined : filePaths[0];
};

/** A message box on the app's window when it has one (before the window opens, a box of its own). */
const messageBox = (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
  const [window] = BrowserWindow.getAllWindows();
  return window === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options);
};

const confirmRestart = async (workspace: string, running: number | undefined): Promise<boolean> => {
  if (e2e !== undefined) return e2e.restartAnswer === "restart";
  const { response } = await messageBox({
    type: "question",
    buttons: ["Restart", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Restart the service for ${workspace}?`,
    detail: running === undefined ? "Its agents stop." : `Its agents stop (${agentCountLabel(running)} with a process).`,
  });
  return response === 0;
};

const reportError = (title: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${title}: ${message}`);
  if (e2e === undefined) dialog.showErrorBox(title, message);
};

// The one workspace control: every start, switch and restart of the service goes through its queue.
const workspace = workspaceControl({
  env: process.env,
  settingsFile: settingsPath(app.getPath("userData")),
  serviceEntry: serviceEntryInUse,
  chooseFolder,
  confirmRestart,
});

const broadcast = (channel: string, value: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value);
};

const showNotice = noticeSink({
  e2e: e2e !== undefined,
  record: recordE2eNotification,
  isSupported: () => Notification.isSupported(),
  create: (options) => new Notification(options),
});

const openAgent = (agentId: string): void => {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(CHANNELS.openAgent, agentId);
};

// It reads the agents through the connection below, only once that connection forwards an alert.
// Under e2e the window's focus depends on the test machine's desktop, so every notice is recorded.
const appFocused = (): boolean => e2e === undefined && BrowserWindow.getFocusedWindow() !== null;

const notices = waitingNotices({ agents: () => connection.agents(), show: showNotice, openAgent, focused: appFocused });

let previousState: ConnectionState["state"] | undefined;

/** The service this launch found already running (workspace.open's `found`), set once at launch; undefined if it started one. */
let foundAtLaunch: DiscoveryFile | undefined;

// The page's way to the service: main holds the token, the page sees the states and alerts.
const connection = serviceConnection({
  discoveryFile: () => discoveryPath(process.env),
  // Hashed on each connect and each stale check: the code on disk may change while the app runs.
  codeIdOnDisk: () => codeIdOf(serviceAppRoot),
  // The token is new with every start, so a service started since (a Restart, a switch) is never taken for it.
  foundAtLaunch: (file) => file.token === foundAtLaunch?.token && file.pid === foundAtLaunch.pid,
  ...(e2e?.staleCheckMs === undefined ? {} : { timing: { staleCheckMs: e2e.staleCheckMs } }),
  onState: (update) => {
    broadcast(CHANNELS.connection, update);
    // Only on the way into connected: the service's info arrives in a later `connected` update of the same connection.
    if (update.state.state === "connected" && previousState !== "connected") notices.onConnected();
    previousState = update.state.state;
  },
  onAlert: (alert) => {
    broadcast(CHANNELS.alert, alert);
    notices.onAlert(alert);
  },
});

/** The bridge's calls; only the app's own page may make them. */
const handleBridge = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isBridgeSender(event.senderFrame?.url, devServerUrl())) throw new Error("Only Wombat's own page may use its bridge.");
    return listener(event, ...args);
  });
};

const currentWorkspace = (): string => {
  const root = workspace.settings().workspace;
  if (root === undefined) throw new Error("No workspace is open yet; choose one with Switch Workspace.");
  return root;
};

handleBridge(CHANNELS.request, (_event, method, pathname, body) => connection.request(method, pathname, body));
handleBridge(CHANNELS.connectionNow, () => connection.current());
handleBridge(CHANNELS.workspaceGet, (): WorkspaceInfo => ({ root: currentWorkspace() }));
/**
 * The folder picker, then a switch of the service to the chosen folder (asking first when that stops a running
 * service). A switch that went ahead reloads the page: it holds the old workspace's settings, layout and data, and
 * would otherwise save its layout under the new workspace.
 */
const switchWorkspace = async (): Promise<void> => {
  const folder = await chooseFolder();
  if (folder === undefined || !(await workspace.confirmSwitch(folder))) return;
  await connection.reconnect(async () => {
    await workspace.switchWorkspace(folder);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.reload();
  });
};

/** Stops the service and its agents; the page then shows `failed`, with Restart. */
const stopServiceAndAgents = (): Promise<void> => connection.shutdown(() => workspace.shutdown());

/**
 * The running service's agents, for the quit, stop and restart questions: undefined when no service runs
 * (runningService); rejects when its process runs but doesn't answer, so the question is still asked.
 */
const serviceAgents = async () => {
  const running = runningService(discoveryPath(process.env));
  return running === undefined ? undefined : listAgents(running.file);
};

const confirmStop = async (running: number | undefined): Promise<boolean> => {
  if (e2e !== undefined) return e2e.stopAnswer === "stop";
  const { response } = await messageBox({
    type: "warning",
    buttons: ["Stop", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: running === undefined ? "Stop the service and its agents?" : `Stop the service and its ${agentCountLabel(running)} with a process?`,
    detail: "Agents stop mid-task. Restart starts the service again, without them.",
  });
  return response === 0;
};

// A failed Restart is reported here, in any state, as the menu's Stop is: the page may show anything by then. It still
// rejects, so the page's Restart settles as failed.
handleBridge(CHANNELS.restart, async () => {
  try {
    await restartService({
      agents: serviceAgents,
      confirm: confirmStop,
      stop: stopServiceAndAgents,
      start: () => connection.reconnect(() => workspace.restart()),
    });
  } catch (error) {
    reportError("Wombat couldn't restart the service", error);
    throw error;
  }
});
handleBridge(CHANNELS.workspaceSwitch, switchWorkspace);
handleBridge(CHANNELS.settingsGet, () => workspace.pageSettings());
handleBridge(CHANNELS.settingsSet, (_event, patch) => {
  workspace.setPageSettings(patch);
});

const commands = mainCommands({
  switchWorkspace: () => switchWorkspace().catch((error: unknown) => reportError("Wombat couldn't switch the workspace", error)),
  stopService: () =>
    stopIfConfirmed({ agents: serviceAgents, confirm: confirmStop, stop: stopServiceAndAgents }).then(
      () => undefined,
      (error: unknown) => reportError("Wombat couldn't stop the service", error),
    ),
  quit: () => app.quit(),
  titleBarOverlay: overlayAt,
  zoom: {
    level: () => workspace.settings().zoomLevel,
    save: (zoomLevel) => workspace.updateSettings((current) => ({ ...current, zoomLevel })),
  },
});
handleBridge(CHANNELS.command, (event, id) => commands.fromPage(id, BrowserWindow.fromWebContents(event.sender) ?? undefined));

const askOnQuit = async (running: number | undefined): Promise<QuitChoice> => {
  if (e2e !== undefined) return { answer: e2e.quitAnswer, dontAsk: e2e.quitDontAsk };
  const { response, checkboxChecked } = await messageBox(quitQuestion(running));
  return quitChoice(response, checkboxChecked);
};

/** How long a quit waits for the desktop to take the "still running" notification. */
const KEPT_NOTICE_WAIT_MS = 1_000;

/** Settles when `promise` does or after `ms`, whichever is first. */
const untilOrAfter = (promise: Promise<void>, ms: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]).finally(() => clearTimeout(timer));
};

// Set once the quit is decided; the next before-quit then lets it through.
let quitDecided = false;
let decidingQuit = false;

const quitNow = (): void => {
  quitDecided = true;
  app.quit();
};

/** The app stays open (a quit cancelled or failed), so it needs a window, even after the last one closed. */
const keepAWindow = (): void => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  createWindow().catch((error: unknown) => {
    // Without a window nothing could reach the app any more; the service and its agents stay as they are.
    reportError("Wombat couldn't open its window again, so it quits. Start it again; the service and its agents are as they were", error);
    quitNow();
  });
};

app.on("before-quit", (event) => {
  if (quitDecided) {
    connection.close();
    return;
  }
  event.preventDefault();
  if (decidingQuit) return;
  decidingQuit = true;
  decideQuit({
    settings: () => workspace.settings(),
    updateSettings: workspace.updateSettings,
    idle: () => workspace.idle(),
    agents: serviceAgents,
    ask: askOnQuit,
    stop: stopServiceAndAgents,
    // No click action: the app has quit by the time it could be clicked. The quit waits (a little) until the desktop
    // has the notification, as the process exiting right after could otherwise drop it.
    notifyKept: (running) => untilOrAfter(showNotice(keptNotice(running)).shown, KEPT_NOTICE_WAIT_MS),
  })
    .then(
      (quit) => {
        if (quit) quitNow();
        else keepAWindow();
      },
      (error: unknown) => {
        reportError("Wombat didn't quit: it couldn't stop the service", error);
        keepAWindow();
      },
    )
    .finally(() => {
      decidingQuit = false;
    });
});

/** Picks the workspace and starts its service; false when the app should quit (cancelled, or it couldn't). */
const openWorkspace = async (): Promise<boolean> => {
  try {
    const opened = await workspace.open();
    if (opened === undefined) return false;
    foundAtLaunch = opened.found;
    // A start that fails shows as the `failed` state, and a service from before this app as `incompatible`; both with Restart.
    void connection.reconnect(() => opened.service.then(ofThisApp));
    return true;
  } catch (error) {
    reportError("Wombat couldn't open the workspace", error);
    return false;
  }
};

// Not a top-level await: Electron holds `ready` until the ESM entry has finished evaluating.
app
  .whenReady()
  .then(async () => {
    denyPermissions();
    protocol.handle(APP_SCHEME, serveRenderer);
    Menu.setApplicationMenu(commands.applicationMenu());
    if (!(await openWorkspace())) {
      // Nothing opened, so nothing to ask about (a service left running is another workspace's).
      quitNow();
      return;
    }
    await createWindow();
  })
  .catch((error: unknown) => {
    console.error(
      "Wombat couldn't open its window. Rebuild it (`pnpm --filter @wombat/desktop build`) and start it again; if that doesn't help, the error below says what failed:",
      error,
    );
    app.exit(1);
  });
