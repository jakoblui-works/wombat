import type { ConnectionState } from "../../../shared/bridge.ts";

export type Connection = ConnectionState["state"];

/** How the status bar's service item looks; `warn` (amber) is a service that runs but isn't quite right. */
export type ServiceTone = "ok" | "warn" | "pending" | "down";

export type ConnectionLook = {
  /** The state as a label: the status bar's indicator names it, and the banner heads with it. */
  readonly label: string;
  /** Whether it's still being worked on: the banner's spinner, and an ellipsis on its headline. */
  readonly pulses: boolean;
  /** What the banner tells the user besides its headline (the label); none for `connected`, which has no banner. */
  readonly detail: string;
  /** The status bar's service item: what it says after "Service · ", and its tone. */
  readonly item: { readonly text: string; readonly tone: ServiceTone };
  /** The status bar panel's first line. */
  readonly line: string;
};

/** How each connection state shows: the banner, and the status bar's item and panel (through serviceView). */
export const CONNECTION_STATES: Readonly<Record<Connection, ConnectionLook>> = {
  connected: {
    label: "Connected to the service",
    pulses: false,
    detail: "",
    item: { text: "running", tone: "ok" },
    line: "Running",
  },
  connecting: {
    label: "Connecting to the service",
    pulses: true,
    detail: "Your agents keep running.",
    item: { text: "connecting…", tone: "pending" },
    line: "Connecting…",
  },
  reconnecting: {
    label: "Reconnecting to the service",
    pulses: true,
    detail: "Your agents keep running.",
    item: { text: "connecting…", tone: "pending" },
    line: "Reconnecting…",
  },
  failed: {
    label: "Can't connect to the service",
    pulses: false,
    detail: "Restart it to try again.",
    item: { text: "not connected", tone: "down" },
    line: "Not connected: the app can't reach it.",
  },
  incompatible: {
    label: "The service doesn't match this app's version",
    pulses: false,
    detail: "Restart it to use this app's own.",
    item: { text: "doesn't match this app", tone: "warn" },
    line: "Running, but it doesn't match this app's version. Restart it.",
  },
};

/** The banner's headline: the state's label, with an ellipsis while it's still being worked on. */
export const bannerTitle = (state: Connection): string => `${CONNECTION_STATES[state].label}${CONNECTION_STATES[state].pulses ? "…" : ""}`;

/** Whether no retry is coming: the connection stays as it is until the user acts (Restart). */
export const isSettled = (state: Connection): boolean => state === "failed" || state === "incompatible";

/**
 * Whether the disconnected banner (and the dimmed, inert views under it) shows. The first `connecting` is the app
 * starting, not a loss; `failed` and `incompatible` show even before any connect (nothing works, and Restart is the
 * way out); once connected, any other state is a loss.
 */
export const showsBanner = (state: Connection, connectedBefore: boolean): boolean => {
  if (state === "connected") return false;
  if (isSettled(state)) return true;
  return connectedBefore || state === "reconnecting";
};

/** A Restart the user started: pending until it settles, and the reason it failed, if it did. */
export type RestartAttempt = { readonly pending: boolean; readonly error?: string };
export type RestartEvent =
  | { readonly type: "start" }
  | { readonly type: "settled" }
  | { readonly type: "rejected"; readonly error: string }
  | { readonly type: "connection"; readonly state: Connection };

export const NO_RESTART: RestartAttempt = { pending: false };

/**
 * How a Restart attempt moves. The connection changing state mid-attempt (main goes to `connecting` before the restart
 * settles) neither ends the attempt nor hides its error: the error stays until the next attempt starts or the
 * connection is `connected`.
 */
export const restartAttempt = (attempt: RestartAttempt, event: RestartEvent): RestartAttempt => {
  switch (event.type) {
    case "start":
      return { pending: true };
    case "settled":
      return { ...attempt, pending: false };
    case "rejected":
      return { pending: false, error: event.error };
    case "connection":
      return event.state === "connected" && attempt.error !== undefined ? { pending: attempt.pending } : attempt;
  }
};
