// The only reader of the WOMBAT_E2E* variables: the e2e checks drive the app through them. Without WOMBAT_E2E=1
// every switch is off, so the built app behaves as the real one whatever else is in its env.

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

/** The main-process global (an array) the checks read the recorded notifications from. */
export const E2E_NOTIFICATIONS = "wombatE2eNotifications";

/** Records a notification the app would have shown, for the checks to read. */
export const recordE2eNotification = (notification: { title: string; body: string }): void => {
  const global = globalThis as Record<string, unknown>;
  const recorded = Array.isArray(global[E2E_NOTIFICATIONS]) ? (global[E2E_NOTIFICATIONS] as unknown[]) : [];
  recorded.push({ ...notification });
  global[E2E_NOTIFICATIONS] = recorded;
};

/** The switches, or undefined (the real app: show windows and dialogs) unless WOMBAT_E2E=1. */
export const readE2eSwitches = (env: NodeJS.ProcessEnv): E2eSwitches | undefined => {
  if (env["WOMBAT_E2E"] !== "1") return undefined;
  const nonEmpty = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);
  return {
    workspace: nonEmpty(env["WOMBAT_E2E_WORKSPACE"]),
    serviceEntry: nonEmpty(env["WOMBAT_E2E_SERVICE_ENTRY"]),
    restartAnswer: env["WOMBAT_E2E_RESTART_ANSWER"] === "restart" ? "restart" : "cancel",
    quitAnswer: QUIT_ANSWERS.includes(env["WOMBAT_E2E_QUIT_ANSWER"] ?? "") ? (env["WOMBAT_E2E_QUIT_ANSWER"] as QuitAnswer) : "cancel",
    quitDontAsk: env["WOMBAT_E2E_QUIT_DONT_ASK"] === "1",
    stopAnswer: env["WOMBAT_E2E_STOP_ANSWER"] === "stop" ? "stop" : "cancel",
  };
};
