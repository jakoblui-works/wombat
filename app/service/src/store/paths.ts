import { isAbsolute, join } from "node:path";

/**
 * Where the service keeps its database: `$XDG_STATE_HOME/wombat/service.db`, or `~/.local/state/...` when
 * `XDG_STATE_HOME` is unset or relative (the XDG spec says to ignore relative values).
 */
export const defaultStorePath = (env: NodeJS.ProcessEnv): string => {
  const stateHome = env.XDG_STATE_HOME;
  if (stateHome !== undefined && isAbsolute(stateHome)) return join(stateHome, "wombat", "service.db");
  const home = env.HOME;
  if (home === undefined || !isAbsolute(home)) {
    throw new Error(
      "Can't find a place for the service's database: HOME isn't an absolute path and XDG_STATE_HOME isn't set or isn't absolute. " +
        "Set HOME, or XDG_STATE_HOME to an absolute folder, and start the service again.",
    );
  }
  return join(home, ".local", "state", "wombat", "service.db");
};
