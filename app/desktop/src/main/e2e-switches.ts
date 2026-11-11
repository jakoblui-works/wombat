// The only reader of the WOMBAT_E2E* variables: the e2e checks drive the app through them. Without WOMBAT_E2E=1
// every switch is off, so the built app behaves as the real one whatever else is in its env.

export type RestartAnswer = "restart" | "cancel";

export type E2eSwitches = {
  /** The answer to the workspace folder dialog, which then never opens; undefined is a cancelled dialog. */
  workspace: string | undefined;
  /** Replaces the service's entry file (the checks' fake-agent entry). */
  serviceEntry: string | undefined;
  /** The answer to "Restart the service for …?"; unset is Cancel. */
  restartAnswer: RestartAnswer;
};

/** The switches, or undefined (the real app: show windows and dialogs) unless WOMBAT_E2E=1. */
export const readE2eSwitches = (env: NodeJS.ProcessEnv): E2eSwitches | undefined => {
  if (env["WOMBAT_E2E"] !== "1") return undefined;
  const nonEmpty = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);
  return {
    workspace: nonEmpty(env["WOMBAT_E2E_WORKSPACE"]),
    serviceEntry: nonEmpty(env["WOMBAT_E2E_SERVICE_ENTRY"]),
    restartAnswer: env["WOMBAT_E2E_RESTART_ANSWER"] === "restart" ? "restart" : "cancel",
  };
};
