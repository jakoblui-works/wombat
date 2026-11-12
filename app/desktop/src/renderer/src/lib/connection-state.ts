import { Circle, CircleAlert, CircleX, type LucideIcon } from "lucide-react";

import type { ConnectionState } from "../../../shared/bridge.ts";

export type Connection = ConnectionState["state"];

export type ConnectionLook = {
  /** What the indicator says, as its label. */
  readonly label: string;
  /** The text-colour utility bound to the state's token (tokens.css). */
  readonly colour: string;
  /** Its own shape, so states are told apart by more than colour. */
  readonly icon: LucideIcon;
  /** Whether the icon is drawn filled (a solid dot) rather than as an outline. */
  readonly filled: boolean;
  /** Whether the icon pulses while the state lasts. */
  readonly pulses: boolean;
  /** What the banner tells the user besides its headline (the label); none for `connected`, which has no banner. */
  readonly detail?: string;
};

/** How each connection state shows: the activity bar's indicator and the banner. */
export const CONNECTION_STATES: Readonly<Record<Connection, ConnectionLook>> = {
  connected: {
    label: "Connected to the service",
    colour: "text-connection-ok",
    icon: Circle,
    filled: true,
    pulses: false,
    detail: "",
  },
  connecting: {
    label: "Connecting to the service",
    colour: "text-connection-lost",
    icon: Circle,
    filled: false,
    pulses: true,
    detail: "Your agents keep running.",
  },
  reconnecting: {
    label: "Reconnecting to the service",
    colour: "text-connection-lost",
    icon: Circle,
    filled: false,
    pulses: true,
    detail: "Your agents keep running.",
  },
  failed: {
    label: "Can't connect to the service",
    colour: "text-connection-lost",
    icon: CircleX,
    filled: false,
    pulses: false,
    detail: "Restart it to try again.",
  },
  incompatible: {
    label: "The service doesn't match this app's version",
    colour: "text-connection-lost",
    icon: CircleAlert,
    filled: false,
    pulses: false,
    detail: "Restart it to use this app's own.",
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
