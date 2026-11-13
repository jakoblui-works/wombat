// The commands main runs for the page (window.wombat.command), the app's zoom, and the application menu. The keys are
// the page's (its command registry); main's menu has no accelerator whose key the page also binds, or one key press
// would run a command twice.
import { BrowserWindow, Menu, type WebContents } from "electron";
import { CHANNELS, isMainCommandId, type MainCommandId } from "../shared/bridge.ts";
import { type TitleBarOverlay } from "./title-bar.ts";
import { isUserInput, pageMayRun } from "./user-input.ts";
import { clampZoom, ZOOM_STEP } from "./zoom.ts";

export type MainCommandDeps = {
  /** The File menu's Switch Workspace: the folder picker, then the switch; reports its own errors. */
  switchWorkspace: () => Promise<void>;
  /** The File menu's Stop Service and Agents: asks, then stops; reports its own errors. */
  stopService: () => Promise<void>;
  /** The app's quit, through its before-quit question. */
  quit: () => void;
  /** The saved zoom level, read once to start from, and its save (settings.json's zoomLevel). */
  zoom: { level: () => number; save: (level: number) => void };
  /** The window controls' overlay for a zoom level, kept in step with the zoom; undefined when windows have none. */
  titleBarOverlay?: ((level: number) => TitleBarOverlay) | undefined;
  log?: (line: string) => void;
};

export type MainCommands = {
  /**
   * Runs main command `id` for `win`, the window that asked (edit and window commands act on it; zoom acts on every
   * window). The bridge handler and anything else in main run commands only through here.
   */
  runMainCommand: (id: MainCommandId, win: BrowserWindow | undefined) => Promise<void>;
  /**
   * The bridge's command(): `id` is the page's, so anything outside MAIN_COMMAND_IDS is refused and nothing runs, and
   * so is a clipboard command without the user's input to `win` just before (`pageMayRun`).
   */
  fromPage: (id: unknown, win: BrowserWindow | undefined) => Promise<void>;
  /** The zoom level the windows show. */
  zoomLevel: () => number;
  /**
   * Applies the app's zoom level to `win` on every load (Chromium resets it when the page loads again), and notes the
   * user's input to it for `fromPage`.
   */
  watchWindow: (win: BrowserWindow) => void;
  /** The application menu, or null for none. */
  applicationMenu: () => Menu | null;
};

export const mainCommands = ({ switchWorkspace, stopService, quit, zoom, titleBarOverlay, log = console.error }: MainCommandDeps): MainCommands => {
  // The level the windows show; the saved one is only for the next start, so a failed save doesn't hold it back.
  let level = zoom.level();
  const lastInputAt = new WeakMap<WebContents, number>();
  const setZoom = (to: number): void => {
    const next = clampZoom(to);
    level = next;
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setZoomLevel(next);
      if (titleBarOverlay !== undefined) window.setTitleBarOverlay(titleBarOverlay(next));
    }
    try {
      zoom.save(next);
    } catch (error) {
      // The windows keep the new level, through reloads too; the next start opens at the last level saved.
      log(`Wombat couldn't save the zoom level: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.zoom, next);
  };

  const runMainCommand = async (id: MainCommandId, win: BrowserWindow | undefined): Promise<void> => {
    const contents = win?.webContents;
    switch (id) {
      case "zoom.in":
        return setZoom(level + ZOOM_STEP);
      case "zoom.out":
        return setZoom(level - ZOOM_STEP);
      case "zoom.reset":
        return setZoom(0);
      case "edit.undo":
        return contents?.undo();
      case "edit.redo":
        return contents?.redo();
      case "edit.cut":
        return contents?.cut();
      case "edit.copy":
        return contents?.copy();
      case "edit.paste":
        return contents?.paste();
      case "edit.selectAll":
        return contents?.selectAll();
      case "window.minimize":
        return win?.minimize();
      case "window.maximize":
        if (win?.isMaximized()) win.unmaximize();
        else win?.maximize();
        return;
      case "window.close":
        return win?.close();
      case "workspace.switch":
        return switchWorkspace();
      case "service.stop":
        return stopService();
      case "app.quit":
        return quit();
    }
  };

  return {
    runMainCommand,
    fromPage: (id, win) => {
      if (!isMainCommandId(id)) {
        return Promise.reject(new Error("Wombat's main process has no such command; send one of MAIN_COMMAND_IDS (src/shared/bridge.ts)."));
      }
      if (!pageMayRun(id, win === undefined ? undefined : lastInputAt.get(win.webContents), Date.now())) {
        return Promise.reject(
          new Error("Cut, copy and paste run only right after you click or press a key in the window. Use them from the Edit menu or with their keys."),
        );
      }
      return runMainCommand(id, win);
    },
    zoomLevel: () => level,
    watchWindow: (win) => {
      const contents = win.webContents;
      contents.on("input-event", (_event, input) => {
        if (isUserInput(input.type)) lastInputAt.set(contents, Date.now());
      });
      contents.on("did-finish-load", () => {
        contents.setZoomLevel(level);
        if (titleBarOverlay !== undefined) win.setTitleBarOverlay(titleBarOverlay(level));
      });
    },
    // macOS gives text fields their clipboard keys only through the menu's edit roles. Elsewhere no menu at all:
    // without one Electron would set its default, whose zoom and close accelerators run alongside the page's keys.
    applicationMenu: () => (process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]) : null),
  };
};
