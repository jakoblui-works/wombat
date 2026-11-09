import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { discoveryPath } from "./discovery.ts";
import { defaultStorePath } from "./store/paths.ts";

/** The service's port when WOMBAT_PORT is unset. */
export const DEFAULT_PORT = 14900;

export type Config = {
  /** 0 picks a free port. */
  port: number;
  workspaceRoot: string;
  /** The folder of structures and item files; unset when the items aren't configured. */
  itemsRoot?: string;
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

const readWorkspace = (value: string | undefined): string => {
  const fix = "Set WOMBAT_WORKSPACE to the absolute path of the folder that holds the project's repos.";
  if (value === undefined || value === "") throw new Error(`WOMBAT_WORKSPACE isn't set. ${fix}`);
  if (!isAbsolute(value)) throw new Error(`WOMBAT_WORKSPACE is ${JSON.stringify(value)}, which isn't an absolute path. ${fix}`);
  let isDir: boolean;
  try {
    isDir = statSync(value).isDirectory();
  } catch {
    // Missing, or behind a folder this user can't enter (EACCES): either way not a folder the service can use.
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`WOMBAT_WORKSPACE is ${JSON.stringify(value)}, which isn't an existing folder you can use. ${fix}`);
  }
  return value;
};

const readItems = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const fix = "Set WOMBAT_ITEMS to the absolute path of the folder that holds the items' structures, or unset it to run without items.";
  if (!isAbsolute(value)) throw new Error(`WOMBAT_ITEMS is ${JSON.stringify(value)}, which isn't an absolute path. ${fix}`);
  let isDir: boolean;
  try {
    isDir = statSync(value).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new Error(`WOMBAT_ITEMS is ${JSON.stringify(value)}, which isn't an existing folder you can use. ${fix}`);
  return value;
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
  const itemsRoot = readItems(env.WOMBAT_ITEMS);
  return {
    port: readPort(env.WOMBAT_PORT),
    workspaceRoot: readWorkspace(env.WOMBAT_WORKSPACE),
    ...(itemsRoot === undefined ? {} : { itemsRoot }),
    storePath: readStore(env),
    discoveryPath: discoveryPath(env),
  };
};
