// Reading and writing item files. Every write under an items root, the catalog's first-sight assignments and the
// writer's changes alike, runs through that root's one queue, compares the file's version just before writing,
// and replaces the file atomically, so a hand edit or a parallel write is never overwritten unseen.
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** sha256 (hex) of a file's bytes: an item's version. */
export const versionOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type VersionedFile = { bytes: Buffer; text: string; version: string };

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** The file's bytes, text and version; undefined when it doesn't exist (any other read error throws). */
export const readVersioned = async (path: string): Promise<VersionedFile | undefined> => {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return { bytes, text: bytes.toString("utf8"), version: versionOf(bytes) };
};

/**
 * Replaces (or creates) the file through a temp file in the same folder and a rename, so a reader sees the old
 * file or the new one, never half of one. An existing file keeps its mode. The temp name starts with a dot and
 * ends in `.tmp`, so a scan never takes it for an item.
 */
export const writeAtomic = async (path: string, data: string | Uint8Array) => {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(path)).mode & 0o7777;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    await writeFile(temp, data, { flag: "wx" });
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

const queues = new Map<string, Promise<unknown>>();

/** The root's real path, so two spellings of one root (a symlink, `..`) share a queue. */
const queueKey = (root: string) => {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
};

/**
 * Runs `job` after every job queued before it for the same items root, in this process. Module state keyed by
 * the root's real path, so a catalog and a writer opened separately on one root share it. A failed job doesn't
 * stop the ones after it. Keep jobs short: re-read the file, compare its version, write.
 */
export const queueWrite = <T>(root: string, job: () => Promise<T>): Promise<T> => {
  const key = queueKey(root);
  const run = (queues.get(key) ?? Promise.resolve()).then(job);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
};
