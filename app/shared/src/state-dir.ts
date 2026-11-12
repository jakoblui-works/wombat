/// <reference types="node" />
// Node-only: where the service and the app keep their state on the host.
import { isAbsolute, join } from "node:path";

/**
 * `$XDG_STATE_HOME/wombat`, or `~/.local/state/wombat` when `XDG_STATE_HOME` is unset or relative (the XDG spec says
 * to ignore relative values); throws when neither gives an absolute folder.
 */
export const stateDir = (env: NodeJS.ProcessEnv): string => {
  const stateHome = env.XDG_STATE_HOME;
  if (stateHome !== undefined && isAbsolute(stateHome)) return join(stateHome, "wombat");
  const home = env.HOME;
  if (home === undefined || !isAbsolute(home)) {
    throw new Error(
      "Can't find a place for Wombat's state (the service's database and log): HOME isn't an absolute path and XDG_STATE_HOME " +
        "isn't set or isn't absolute. Set HOME, or XDG_STATE_HOME to an absolute folder, and start Wombat again.",
    );
  }
  return join(home, ".local", "state", "wombat");
};
