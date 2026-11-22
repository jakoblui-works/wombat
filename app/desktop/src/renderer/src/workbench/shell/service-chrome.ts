// What the window shows about the service around the panels: whether the connection banner blocks them, the Restart
// attempt, and the launch notice's dismissal.
import { useCallback, useEffect, useReducer, useState } from "react";

import type { ConnectionState } from "../../../../shared/bridge.ts";
import { NO_RESTART, type RestartAttempt, restartAttempt, showsBanner } from "@/lib/connection-state";
import { useConnection } from "../../data/hooks.ts";
import { commandForKey, runLogged } from "../commands/registry.ts";

// The launch notice's dismissal, in sessionStorage: it survives a reload of the window (main still reports the service
// as found at launch) and starts empty on the next launch. Storage that fails only costs the notice coming back.
const NOTICE_DISMISSED_KEY = "wombat.launchNoticeDismissed";

const noticeDismissedBefore = (): boolean => {
  try {
    return sessionStorage.getItem(NOTICE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

const rememberNoticeDismissed = (): void => {
  try {
    sessionStorage.setItem(NOTICE_DISMISSED_KEY, "1");
  } catch {
    // Kept for this page only.
  }
};

export type ServiceChrome = {
  connection: ConnectionState;
  /** The connection banner shows, and the panels behind it are inert. */
  blocked: boolean;
  attempt: RestartAttempt;
  restart: () => void;
  noticeShown: boolean;
  dismissNotice: () => void;
};

export const useServiceChrome = (): ServiceChrome => {
  const connection = useConnection();
  const { state } = connection;
  // Whether the service was ever connected: the first `connecting` is the app starting, not a loss.
  const [connectedBefore, setConnectedBefore] = useState(false);
  if (state === "connected" && !connectedBefore) setConnectedBefore(true);
  const blocked = showsBanner(state, connectedBefore);

  // Kept here, not in the banner, which unmounts when the state moves (a first connecting) while a restart runs.
  const [attempt, dispatchAttempt] = useReducer(restartAttempt, NO_RESTART);
  useEffect(() => dispatchAttempt({ type: "connection", state }), [state]);

  // Whether the launch notice shows is serviceView's (main says whether the service was found at launch); the page
  // only remembers that it was dismissed, or that Restart replaced the service it was about, for the launch.
  const [noticeDismissed, setNoticeDismissed] = useState(noticeDismissedBefore);
  const dismissNotice = useCallback(() => {
    rememberNoticeDismissed();
    setNoticeDismissed(true);
  }, []);

  const restart = useCallback(() => {
    dismissNotice();
    dispatchAttempt({ type: "start" });
    window.wombat.service.restart().then(
      () => dispatchAttempt({ type: "settled" }),
      (failure: unknown) =>
        dispatchAttempt({
          type: "rejected",
          error: `Couldn't restart the service${failure instanceof Error ? `: ${failure.message}` : ""}. Try Restart again.`,
        }),
    );
  }, [dismissNotice]);

  return { connection, blocked, attempt, restart, noticeShown: !noticeDismissed && !blocked, dismissNotice };
};

/** The page's one key listener: every key binding runs through the command registry. */
export const useCommandKeys = (): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const found = commandForKey(event);
      if (found === undefined) return;
      event.preventDefault();
      runLogged(found.command.id, found.element === undefined ? {} : { element: found.element });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};
