import { join } from "node:path";

import { stateDir } from "@wombat/shared/state-dir";

/** Where the service keeps its database: `service.db` in Wombat's state folder. */
export const defaultStorePath = (env: NodeJS.ProcessEnv): string => join(stateDir(env), "service.db");
