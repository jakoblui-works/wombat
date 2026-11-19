// The one watch of the items root: a recursive fs.watch, debounced, restarted when it fails or when the root is
// removed and put back. Every listener hears each settled change to an item file or a binder's settings.
import { statSync, watch, type FSWatcher } from "node:fs";

import { errorCode } from "@wombat/shared/errno";

import { logToStderr, type Log } from "../log.ts";
import { isSkippedPath, OLD_SETTINGS_FILE, SETTINGS_FILE } from "./binders.ts";

/** How long the watch waits after the last change before it tells its listeners (about 200 ms). */
export const WATCH_DEBOUNCE_MS = 200;
/** How long a failed watcher first waits before it is started again; the wait doubles while it keeps failing. */
export const WATCH_RESTART_MS = 1_000;
/** The longest wait between restarts of a watcher that keeps failing (e.g. the inotify limit reached). */
export const WATCH_RESTART_MAX_MS = 60_000;
/** How often the watched root is checked for having been removed or replaced. */
export const ROOT_CHECK_MS = 2_000;

export type WatchTiming = { debounceMs?: number; rootCheckMs?: number; watchRestartMs?: number };

export type WatchOptions = {
  root: string;
  /** The waits, for a test that can't sit through the real ones; the constants above when absent. */
  timing?: WatchTiming;
  log?: Log;
};

export type Watch = {
  /** Calls `listener` after each settled change; returns the unsubscribe. */
  on: (listener: () => void) => () => void;
  close: () => void;
};

/** The directory at a path, as device, inode and birth time: changes when the path is removed and made again
 *  (the inode number alone is often reused at once). Where the filesystem has no birth time it reads 0 and a
 *  replaced root that reuses its inode goes unnoticed until the service restarts. */
const rootIdentity = (path: string) => {
  const { dev, ino, birthtimeNs } = statSync(path, { bigint: true });
  return `${String(dev)}:${String(ino)}:${String(birthtimeNs)}`;
};

/** True for a changed path (relative to the items root) that is an item or a binder's settings. */
const isItemsChange = (filename: string | null) => {
  if (filename === null) return true;
  const parts = filename.split(/[\\/]/);
  if (isSkippedPath(parts.join("/"))) return false;
  const name = parts.at(-1) ?? "";
  return name.endsWith(".md") || name === SETTINGS_FILE || name === OLD_SETTINGS_FILE;
};

/** Starts watching `root` at once. */
export const openWatch = ({ root, timing = {}, log = logToStderr }: WatchOptions): Watch => {
  const { debounceMs = WATCH_DEBOUNCE_MS, rootCheckMs = ROOT_CHECK_MS, watchRestartMs = WATCH_RESTART_MS } = timing;
  const listeners = new Set<() => void>();
  let closed = false;
  let watcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let restart: NodeJS.Timeout | undefined;
  let rootCheck: NodeJS.Timeout | undefined;

  const tell = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log("items_watch_listener_failed", { error: errorCode(error) });
      }
    }
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(tell, debounceMs);
  };

  // While starting the watcher keeps failing (e.g. the inotify limit), the wait doubles and the failure is logged
  // once, not on every attempt; a start that works resets both.
  let retryMs = watchRestartMs;
  let failing = false;

  const start = () => {
    if (closed) return;
    const retry = (error: unknown) => {
      clearInterval(rootCheck);
      watcher?.close();
      watcher = undefined;
      if (!failing) log("instructions_watch_failed", { error: errorCode(error), retryMs });
      failing = true;
      clearTimeout(restart);
      const wait = retryMs;
      retryMs = Math.min(retryMs * 2, WATCH_RESTART_MAX_MS);
      restart = setTimeout(() => {
        if (closed) return;
        start();
        if (watcher !== undefined) {
          log("instructions_watch_restarted", {});
          failing = false;
          retryMs = watchRestartMs;
          // Changes made while nothing watched are caught up here: only once the watch is back, never while the
          // root is missing, which listeners would read as every item gone.
          schedule();
        }
      }, wait);
    };
    try {
      const identity = rootIdentity(root);
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (isItemsChange(filename)) schedule();
      });
      watcher.on("error", retry);
      // A root that is removed and put back (a re-clone) leaves the watch on the old directory with no error and
      // no further events, so the path is checked now and then and the watch restarted when it points elsewhere.
      clearInterval(rootCheck);
      rootCheck = setInterval(() => {
        let now: string | undefined;
        try {
          now = rootIdentity(root);
        } catch {
          now = undefined;
        }
        if (now !== identity) {
          clearInterval(rootCheck);
          retry(Object.assign(new Error("the items root was moved or replaced"), { code: "ROOT_REPLACED" }));
        }
      }, rootCheckMs);
      rootCheck.unref();
    } catch (error) {
      retry(error);
    }
  };

  start();

  return {
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
      clearTimeout(debounce);
      clearTimeout(restart);
      clearInterval(rootCheck);
      watcher?.close();
      watcher = undefined;
    },
  };
};
