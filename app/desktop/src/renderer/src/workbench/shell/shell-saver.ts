import type { QueryState } from "@tanstack/react-query";

import type { ConnectionState } from "../../../../shared/bridge.ts";
import { isSettled } from "@/lib/connection-state";
import type { SavedShell } from "./shell-state.ts";

/** How long the shell must stay unchanged before it's saved. */
export const SHELL_SAVE_DELAY_MS = 500;

/**
 * Whether a list read (the agents, the proposals) has an answer the restore can go by: the list, or a failure while
 * connected, failed or incompatible. A read refused while (re)connecting doesn't count: it's read again once connected.
 */
export const readAnswered = (state: QueryState | undefined, connection: ConnectionState["state"]): boolean =>
  state?.status === "success" ||
  (state?.status === "error" && state.fetchStatus === "idle" && (connection === "connected" || isSettled(connection)));

export type ShellSaver = {
  /** Saves `saved` once nothing has changed for the delay, unless it is what was last saved or restored. */
  offer: (saved: SavedShell) => void;
  /** Drops any pending save and makes every later `offer` a no-op (the page is unloading). */
  stop: () => void;
};

/**
 * Starts from `restored`, the saved form of the shell the restore gave: a restore that fell back to the default leaves
 * the saved value (perhaps one a newer app wrote) as it is until the shell changes.
 */
export const shellSaver = (restored: SavedShell, write: (saved: SavedShell) => void, delayMs = SHELL_SAVE_DELAY_MS): ShellSaver => {
  let last = JSON.stringify(restored);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  return {
    offer: (saved) => {
      if (stopped) return;
      clearTimeout(timer);
      timer = undefined;
      const text = JSON.stringify(saved);
      if (text === last) return;
      timer = setTimeout(() => {
        timer = undefined;
        last = text;
        // Plain JSON: main refuses a shell that isn't, and a tab's params may hold a field set to undefined.
        write(JSON.parse(text) as SavedShell);
      }, delayMs);
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
};
