// The names the e2e checks drive the app by (interface-S3's E2E switches), in a file with no imports so the desktop
// unit tests can check them against the app's one reader (src/main/e2e-switches-names.test.ts): a typo on either
// side fails there, not as an e2e that silently runs without its switch.

/** The app's e2e switches, read only under WOMBAT_E2E=1. */
export const SWITCH = {
  /** "1" turns the switches on (and keeps the window hidden). */
  e2e: "WOMBAT_E2E",
  /** The answer to the workspace folder dialog, which then never opens. */
  workspace: "WOMBAT_E2E_WORKSPACE",
  /** The service's entry (the checks' fake-agent entry). */
  serviceEntry: "WOMBAT_E2E_SERVICE_ENTRY",
  /** The quit question's answer: stop | leave | cancel. */
  quitAnswer: "WOMBAT_E2E_QUIT_ANSWER",
  /** The quit question's "Don't ask again" box, ticked with "1". */
  quitDontAsk: "WOMBAT_E2E_QUIT_DONT_ASK",
  /** The answer to "Restart the service for <new>?": restart | cancel. */
  restartAnswer: "WOMBAT_E2E_RESTART_ANSWER",
  /** The answer to the menu's "Stop the service and its agents?": stop | cancel. */
  stopAnswer: "WOMBAT_E2E_STOP_ANSWER",
} as const;

/** The main-process global (an array) where the app records its notifications under WOMBAT_E2E=1 instead of showing them. */
export const RECORDED_NOTIFICATIONS = "wombatE2eNotifications";
