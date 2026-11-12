// The names the e2e checks drive the app by: the app's one reader (src/main/e2e-switches.ts) and the checks both
// take them from here. No imports, as src/shared/ stays free of Node and Electron.

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
