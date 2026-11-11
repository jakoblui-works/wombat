import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";

import { readDiscovery, type DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";

import { isMissing } from "./errno.ts";

/** A fresh random bearer token (at least 16 characters). */
export const newToken = (): string => randomBytes(32).toString("base64url");

/**
 * Writes the file atomically (the app never reads a half-written one), private to the user: it holds the bearer
 * token. Looser existing modes are tightened.
 */
export const writeDiscovery = (path: string, file: DiscoveryFile): void => writePrivateFile(path, `${JSON.stringify(file)}\n`);

/** Removes the file only if it still names `pid`; a missing file is fine. */
export const removeDiscovery = (path: string, pid: number): void => {
  // Another instance may have replaced a file it found stale; that one isn't ours to remove.
  if (readDiscovery(path)?.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};
