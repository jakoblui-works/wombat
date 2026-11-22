import { isAbsolute } from "node:path";

import { discoveryPath } from "@wombat/shared/discovery";

import { defaultStorePath } from "./store/paths.ts";

/** The service's port when WOMBAT_PORT is unset. */
export const DEFAULT_PORT = 14900;

export type Config = {
  /** 0 picks a free port. */
  port: number;
  storePath: string;
  discoveryPath: string;
};

const readPort = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_PORT;
  // Plain digits only: Number() would also take " 80", "1e3", "0x50" or "00080".
  const port = /^(0|[1-9]\d{0,4})$/.test(value) ? Number(value) : Number.NaN;
  if (!(port <= 65535)) {
    throw new Error(
      `WOMBAT_PORT is ${JSON.stringify(value)}, which isn't a port. Set WOMBAT_PORT to a whole number from 0 to 65535 ` +
        `(0 picks a free port), or unset it to use ${String(DEFAULT_PORT)}.`,
    );
  }
  return port;
};

const readStore = (env: NodeJS.ProcessEnv): string => {
  const value = env.WOMBAT_STORE;
  if (value === undefined) return defaultStorePath(env);
  if (!isAbsolute(value)) {
    throw new Error(
      `WOMBAT_STORE is ${JSON.stringify(value)}, which isn't an absolute path. ` +
        "Set WOMBAT_STORE to an absolute path for the service's database, or unset it to use the default.",
    );
  }
  return value;
};

/** The service's config from `env`; throws with a message naming the variable that's wrong and what to set. */
export const readConfig = (env: NodeJS.ProcessEnv): Config => {
  return {
    port: readPort(env.WOMBAT_PORT),
    storePath: readStore(env),
    discoveryPath: discoveryPath(env),
  };
};
