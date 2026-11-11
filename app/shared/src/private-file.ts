/// <reference types="node" />
// Node-only. Files only their user may read: the service's discovery file and start lock hold or guard the bearer
// token, its store holds the agents' history, and the app's settings and the service's log name the user's folders.
// Their folders are 0700, so no other local user can list them either.
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

/** Creates the folder (and its parents) if needed and makes it 0700, tightening a looser existing one. */
export const ensurePrivateDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
  chmodSync(dir, PRIVATE_DIR);
};

/** Makes the file 0600 if it exists. */
export const tightenPrivateFile = (path: string): void => {
  if (existsSync(path)) chmodSync(path, PRIVATE_FILE);
};

/** Creates the file empty if it's missing (never with the umask's mode), keeps its content if not; 0600 either way. */
export const ensurePrivateFile = (path: string): void => {
  ensurePrivateDir(dirname(path));
  closeSync(openSync(path, "a", PRIVATE_FILE));
  chmodSync(path, PRIVATE_FILE);
};

/**
 * Writes `data` to a new 0600 temp file in the target's folder and hands it to `place`; the temp file is gone
 * afterwards either way. The temp name starts with a dot and ends in `.tmp`.
 */
const throughTemp = (path: string, data: string, place: (temp: string) => void) => {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, data, { mode: PRIVATE_FILE, flag: "wx" });
    chmodSync(temp, PRIVATE_FILE);
    place(temp);
  } finally {
    rmSync(temp, { force: true });
  }
};

/** Replaces (or creates) the file atomically, through a temp file and a rename: a reader sees the old file or the new one, never half of one. */
export const writePrivateFile = (path: string, data: string): void =>
  throughTemp(path, data, (temp) => renameSync(temp, path));

/**
 * Creates the file with `data`, atomically and only if it doesn't exist: the temp file is hard-linked into place,
 * which fails with EEXIST when the file is there, and a reader never sees it empty or half-written.
 */
export const createPrivateFile = (path: string, data: string): void =>
  throughTemp(path, data, (temp) => linkSync(temp, path));
