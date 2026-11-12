// The only reader of the WOMBAT_E2E* variables: the e2e checks drive the app through them. Without WOMBAT_E2E=1
// every switch is off, so the built app behaves as the real one whatever else is in its env.
import { SWITCH } from "../shared/e2e-switch-names.ts";

export type RestartAnswer = "restart" | "cancel";
export type QuitAnswer = "stop" | "leave" | "cancel";
export type StopAnswer = "stop" | "cancel";

export type E2eSwitches = {
  /** The answer to the workspace folder dialog, which then never opens; undefined is a cancelled dialog. */
  workspace: string | undefined;
  /** Replaces the service's entry file (the checks' fake-agent entry). */
  serviceEntry: string | undefined;
  /** The answer to "Restart the service for …?"; unset is Cancel. */
  restartAnswer: RestartAnswer;
  /** The answer to the quit question; unset is Cancel. */
  quitAnswer: QuitAnswer;
  /** The quit question's "Don't ask again" box, ticked when WOMBAT_E2E_QUIT_DONT_ASK=1. */
  quitDontAsk: boolean;
  /** The answer to "Stop the service and its agents?" (the menu's Stop Service and Agents); unset is Cancel. */
  stopAnswer: StopAnswer;
};

const QUIT_ANSWERS: readonly string[] = ["stop", "leave", "cancel"] satisfies QuitAnswer[];

/** The main-process global (an array) the e2e reads the recorded notifications from: a waiting agent raises one. */
export const E2E_NOTIFICATIONS = "wombatE2eNotifications";

/**
 * Takes the place of showing a notification under the e2e checks, so the hidden e2e app never shows a real one; the
 * e2e reads what it recorded.
 */
export const recordE2eNotification = (notification: { title: string; body: string }): void => {
  const global = globalThis as Record<string, unknown>;
  const recorded = Array.isArray(global[E2E_NOTIFICATIONS]) ? (global[E2E_NOTIFICATIONS] as unknown[]) : [];
  recorded.push({ ...notification });
  global[E2E_NOTIFICATIONS] = recorded;
};

/** The switches, or undefined (the real app: show windows and dialogs) unless WOMBAT_E2E=1. */
export const readE2eSwitches = (env: NodeJS.ProcessEnv): E2eSwitches | undefined => {
  if (env[SWITCH.e2e] !== "1") return undefined;
  const nonEmpty = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);
  const quitAnswer = env[SWITCH.quitAnswer] ?? "";
  return {
    workspace: nonEmpty(env[SWITCH.workspace]),
    serviceEntry: nonEmpty(env[SWITCH.serviceEntry]),
    restartAnswer: env[SWITCH.restartAnswer] === "restart" ? "restart" : "cancel",
    quitAnswer: QUIT_ANSWERS.includes(quitAnswer) ? (quitAnswer as QuitAnswer) : "cancel",
    quitDontAsk: env[SWITCH.quitDontAsk] === "1",
    stopAnswer: env[SWITCH.stopAnswer] === "stop" ? "stop" : "cancel",
  };
};
