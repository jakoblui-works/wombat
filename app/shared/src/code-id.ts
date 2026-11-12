/// <reference types="node" />
// Which code a service runs: the one hash of the source, for the service (on the checkout it was started from) and
// main (on the checkout it starts the service from). Node-only; the page never imports it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { VersionResponse } from "./api.ts";
import { isMissing } from "./errno.ts";

/** The folders under `app/` whose source a service runs. */
const SOURCE_DIRS = ["service/src", "shared/src"] as const;

const isSource = (name: string): boolean => name.endsWith(".ts") && !name.endsWith(".test.ts");

/**
 * The source files under `dir`, as paths relative to `appRoot` with `/` separators. Throws, naming the folder, when
 * it can't be listed (missing included: that's no checkout of the app, not a tree with no source).
 */
const sourceFiles = (appRoot: string, dir: string): string[] => {
  let entries;
  try {
    entries = readdirSync(path.join(appRoot, dir), { recursive: true, withFileTypes: true });
  } catch (error) {
    throw new Error(`couldn't list ${path.join(appRoot, dir)} (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
  return entries
    .filter((entry) => entry.isFile() && isSource(entry.name))
    .map((entry) => path.relative(appRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
};

/**
 * The file's content; undefined when it went between the listing and the read (an edit that replaces the file, a
 * checkout), so the service and the app skip it alike. Any other failure names the file.
 */
const contentOf = (appRoot: string, file: string): Buffer | undefined => {
  try {
    return readFileSync(path.join(appRoot, file));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new Error(`couldn't read ${path.join(appRoot, file)} (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
};

/**
 * A sha256 over `service/src/**` and `shared/src/**` under `appRoot` (the `app/` folder): `.ts` files, not
 * `*.test.ts`, walked in sorted path order, each path hashed together with its content; hex, 16 characters. A file
 * that vanishes mid-walk is skipped; throws, naming the folder or file, when a source folder is missing or can't be
 * listed, or a file can't be read for another reason.
 */
export const codeIdOf = (appRoot: string): string => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(appRoot, dir)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const content = contentOf(appRoot, file);
    if (content === undefined) continue;
    // Each part's length first, so no two trees run together into the same bytes.
    hash.update(`${file}\0${String(content.length)}\0`);
    hash.update(content);
  }
  return hash.digest("hex").slice(0, 16);
};

/** Stale when `codeId` is absent (a service from before it was reported) or differs from `onDisk`. */
export const isStale = (version: VersionResponse, onDisk: string): boolean => version.codeId !== onDisk;
