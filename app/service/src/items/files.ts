// Reading and writing item files. Every write under an items root, the catalog's first-sight assignments and the
// writer's changes alike, runs through that root's one queue. A change or delete compares the file's version
// just before it lands and a create refuses a file that already exists; files are replaced atomically. So a hand
// edit or a parallel write is never overwritten unseen.
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, link, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { errorCode, isMissing } from "./errno.ts";

/** sha256 (hex) of a file's bytes: an item's version. */
export const versionOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type VersionedFile = { bytes: Buffer; text: string; version: string };

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

/** The file isn't at the version a write or delete was based on; nothing was changed. */
export class VersionChanged extends Error {
  constructor(path: string) {
    super(`${path} changed since it was read; read it again and redo the change.`);
    this.name = "VersionChanged";
  }
}

/**
 * The file as it is now, if it's at `version`; throws VersionChanged otherwise (a missing file too). Every
 * comparison of a file with the version a change was based on runs through here, the writes' and the dry runs'.
 */
export const readAtVersion = async (path: string, version: string): Promise<VersionedFile> => {
  const file = await readVersioned(path);
  if (file?.version !== version) throw new VersionChanged(path);
  return file;
};

/** Throws VersionChanged unless the file is at `version` (when one is given). */
const expectVersion = async (path: string, version: string | undefined) => {
  if (version !== undefined) await readAtVersion(path, version);
};

/** The items root's filesystem can't do what a create needs (hard links). */
export class NoHardLinks extends Error {
  constructor(path: string, code: string, cause: unknown) {
    super(`Can't create files in ${dirname(path)}: its filesystem doesn't support hard links (${code}); keep the items root on a local filesystem.`, { cause });
    this.name = "NoHardLinks";
  }
}

/** Filesystems that can't hard-link answer `link()` with one of these. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EXDEV"]);

export type WriteOptions = {
  /** The file must not exist yet. */
  create?: boolean;
  /** The version the file must still have; compared after the temp file is written, just before it lands. */
  expectedVersion?: string;
  /** The mode the file gets; without it an existing file keeps its own and a new one gets the default. */
  mode?: number;
};

/**
 * Replaces (or creates) the file through a temp file in the same folder and a rename, so a reader sees the old
 * file or the new one, never half of one. An existing file keeps its mode unless
 * `mode` is given. The temp name starts with a dot and ends in `.tmp`, so a scan never takes it for an item. With
 * `create`, the temp file is hard-linked into place, which fails with EEXIST instead of replacing a file made in
 * the meantime.
 */
export const writeAtomic = async (path: string, data: string | Uint8Array, { create = false, expectedVersion, mode: newMode }: WriteOptions = {}) => {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let mode = newMode;
  if (mode === undefined) {
    try {
      mode = (await stat(path)).mode & 0o7777;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  try {
    await writeFile(temp, data, { flag: "wx" });
    if (mode !== undefined) await chmod(temp, mode);
    if (create) await linkNew(temp, path);
    else {
      await expectVersion(path, expectedVersion);
      await rename(temp, path);
    }
  } finally {
    await rm(temp, { force: true });
  }
};

const linkNew = async (temp: string, path: string) => {
  try {
    await link(temp, path);
  } catch (error) {
    const code = errorCode(error);
    if (!NO_HARD_LINKS.has(code)) throw error;
    throw new NoHardLinks(path, code, error);
  }
};

/** Deletes the file if it's still at `version`, compared just before the unlink. */
export const removeUnchanged = async (path: string, version: string) => {
  await expectVersion(path, version);
  await unlink(path);
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
