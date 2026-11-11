import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { discoveryPath, readDiscovery } from "@wombat/shared/discovery";
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, session, shell, type WebContents } from "electron";
import { CHANNELS } from "../shared/bridge.ts";
import { APP_INDEX_URL, APP_SCHEME, contentType, isAppUrl, isBridgeSender, resolveAppFile } from "./app-protocol.ts";
import { readE2eSwitches, recordE2eNotification } from "./e2e-switches.ts";
import { NONCE_PLACEHOLDER, newNonce, pageCsp, withNonce } from "./page-csp.ts";
import { decideQuit, stopIfConfirmed, type QuitChoice } from "./quit.ts";
import { listAgents } from "./service-client.ts";
import { serviceConnection } from "./service-connection.ts";
import { rendererSettings, savePageSettings, settingsPath } from "./settings.ts";
import { waitingNotices, type ShownNotice, type WAITING_NOTICE } from "./waiting-notice.ts";
import { workspaceControl, workspaceRepos } from "./workspace.ts";

// The app's trust boundary (design doc, "App trust boundary"): a sandboxed renderer with no
// Node, no permissions, no new windows, and no navigation away from the app's own page.

const preloadPath = path.join(import.meta.dirname, "../preload/index.cjs");
const rendererRoot = path.join(import.meta.dirname, "../renderer");
// From the built main (out/main) to the service's source, which `node` runs as is.
const serviceEntry = path.join(import.meta.dirname, "../../../service/src/main.ts");

const e2e = readE2eSwitches(process.env);

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
    console.error(`Couldn't open ${parsed.href} in the browser:`, error);
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

// The page itself: a fresh nonce per response, in the CSP header and the csp-nonce meta.
const servePage = async (file: string): Promise<Response> => {
  const html = await readFile(file, "utf8");
  if (!html.includes(NONCE_PLACEHOLDER)) {
    return new Response(
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
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const file = await resolveAppFile(rendererRoot, request.url);
  if (file === null) return new Response("Not found", { status: 404 });
  if (file === (await realpath(indexFile))) return servePage(file);
  return new Response(await readFile(file), {
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

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
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

const confirmRestart = async (workspace: string): Promise<boolean> => {
  if (e2e !== undefined) return e2e.restartAnswer === "restart";
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Restart", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Restart the service for ${workspace}?`,
    detail: "Its agents stop.",
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
  serviceEntry: e2e?.serviceEntry ?? serviceEntry,
  chooseFolder,
  confirmRestart,
});

const broadcast = (channel: string, value: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value);
};

const NOTHING_SHOWN: ShownNotice = { close: () => undefined };

// The notifier keeps the returned handle, and with it the Notification: one that's collected loses its click handler.
const showNotice = (notice: typeof WAITING_NOTICE, onClick: () => void): ShownNotice => {
  if (e2e !== undefined) {
    recordE2eNotification(notice);
    return NOTHING_SHOWN;
  }
  if (!Notification.isSupported()) return NOTHING_SHOWN;
  const shown = new Notification({ title: notice.title, body: notice.body });
  shown.on("click", onClick);
  shown.show();
  return { close: () => shown.close() };
};

const openAgent = (agentId: string): void => {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(CHANNELS.openAgent, agentId);
};

// It reads the agents through the connection below, only once that connection forwards an alert.
const notices = waitingNotices({ agents: () => connection.agents(), show: showNotice, openAgent });

// The page's way to the service: main holds the token, the page sees the states and alerts.
const connection = serviceConnection({
  discoveryFile: () => discoveryPath(process.env),
  onState: (update) => {
    broadcast(CHANNELS.connection, update);
    if (update.state.state === "connected") notices.onConnected();
  },
  onAlert: (alert) => {
    broadcast(CHANNELS.alert, alert);
    notices.onAlert(alert);
  },
});

/** The bridge's calls; only the app's own page may make them. */
const handleBridge = (channel: string, listener: (...args: unknown[]) => unknown): void => {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isBridgeSender(event.senderFrame?.url, devServerUrl())) throw new Error("Only Wombat's own page may use its bridge.");
    return listener(...args);
  });
};

const currentWorkspace = (): string => {
  const root = workspace.settings().workspace;
  if (root === undefined) throw new Error("No workspace is open yet; choose one with Switch Workspace.");
  return root;
};

handleBridge(CHANNELS.request, (method, pathname, body) => connection.request(method, pathname, body));
handleBridge(CHANNELS.restart, () => connection.reconnect(() => workspace.restart()));
handleBridge(CHANNELS.connectionNow, () => connection.current());
handleBridge(CHANNELS.workspaceGet, async () => {
  const root = currentWorkspace();
  return { root, repos: await workspaceRepos(root) };
});
/** The folder picker, then a switch of the service to the chosen folder. */
const switchWorkspace = async (): Promise<void> => {
  const folder = await chooseFolder();
  if (folder !== undefined) await connection.reconnect(() => workspace.switchWorkspace(folder));
};

/** Stops the service and its agents; the page then shows `failed`, with Restart. */
const stopServiceAndAgents = (): Promise<void> => connection.shutdown(() => workspace.shutdown());

/**
 * The running service's agents, for the quit and stop questions: undefined when there's no discovery file; rejects
 * when there is one but its service doesn't answer, so the question is still asked.
 */
const serviceAgents = async () => {
  const file = readDiscovery(discoveryPath(process.env));
  return file === undefined ? undefined : listAgents(file);
};

const confirmStop = async (running: number | undefined): Promise<boolean> => {
  if (e2e !== undefined) return e2e.stopAnswer === "stop";
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Stop", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message:
      running === undefined
        ? "Stop the service and its agents?"
        : `Stop the service and its ${String(running)} running ${running === 1 ? "agent" : "agents"}?`,
    detail: "Agents stop mid-task. Restart starts the service again, without them.",
  });
  return response === 0;
};

handleBridge(CHANNELS.workspaceSwitch, switchWorkspace);
handleBridge(CHANNELS.settingsGet, () => rendererSettings(workspace.settings()));
handleBridge(CHANNELS.settingsSet, (patch) => {
  savePageSettings(workspace.updateSettings, patch);
});

const menu = (): Menu =>
  Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Switch Workspace…",
          click: () => {
            switchWorkspace().catch((error: unknown) => reportError("Wombat couldn't switch the workspace", error));
          },
        },
        {
          label: "Stop Service and Agents",
          click: () => {
            stopIfConfirmed({ agents: serviceAgents, confirm: confirmStop, stop: stopServiceAndAgents }).catch((error: unknown) => {
              reportError("Wombat couldn't stop the service", error);
            });
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);

const askOnQuit = async (running: number | undefined): Promise<QuitChoice> => {
  if (e2e !== undefined) return { answer: e2e.quitAnswer, dontAsk: e2e.quitDontAsk };
  const answers = ["stop", "leave", "cancel"] as const;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Stop agents", "Leave running", "Cancel"],
    defaultId: 1,
    cancelId: 2,
    message: running === undefined ? "Agents may still be running." : `${String(running)} ${running === 1 ? "agent is" : "agents are"} still running.`,
    detail: "Stop them before Wombat quits, or leave them running in the service: they keep working, and Wombat shows them again when it opens.",
    checkboxLabel: "Don't ask again",
  });
  return { answer: answers[response] ?? "cancel", dontAsk: checkboxChecked };
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
    // A start that fails shows as the `failed` state, with Restart.
    void connection.reconnect(() => opened.service);
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
    Menu.setApplicationMenu(menu());
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
