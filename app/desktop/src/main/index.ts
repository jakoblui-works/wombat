import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, protocol, session, shell, type WebContents } from "electron";
import { APP_INDEX_URL, APP_SCHEME, contentType, isAppOrigin, resolveAppFile } from "./app-protocol.ts";
import { readE2eSwitches } from "./e2e-switches.ts";
import { NONCE_PLACEHOLDER, newNonce, pageCsp, withNonce } from "./page-csp.ts";
import { settingsPath } from "./settings.ts";
import { workspaceControl } from "./workspace.ts";

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

// The app's own pages: APP_ORIGIN, or the dev server's origin in development.
const isAppUrl = (url: string): boolean => {
  const devUrl = devServerUrl();
  if (devUrl !== undefined) return URL.parse(url)?.origin === new URL(devUrl).origin;
  return isAppOrigin(url);
};

// https links go to the host's browser; nothing else leaves the app.
const openExternally = (url: string): void => {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== "https:") return;
  shell.openExternal(parsed.href).catch((error: unknown) => {
    console.error(`Couldn't open ${parsed.href} in the browser:`, error);
  });
};

const guardNavigation = (event: Electron.Event<{ url: string }>): void => {
  if (isAppUrl(event.url)) return;
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

/** Picks the workspace and starts its service; false when the app should quit (cancelled, or it couldn't). */
const openWorkspace = async (): Promise<boolean> => {
  try {
    const opened = await workspace.open();
    if (opened === undefined) return false;
    opened.service.catch((error: unknown) => {
      reportError("The Wombat service isn't running", error);
    });
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
    if (!(await openWorkspace())) {
      app.quit();
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
