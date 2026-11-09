import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { DiscoveryFile } from "@wombat/shared/discovery";

/** The file holds the bearer token: no other local user may read it, or list the folder it's in. */
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
const DEFAULT_TIMEOUT_MS = 2_000;

/** `$XDG_RUNTIME_DIR/wombat/service.json`; throws when XDG_RUNTIME_DIR is unset or relative. */
export const discoveryPath = (env: NodeJS.ProcessEnv): string => {
  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (runtimeDir === undefined || !isAbsolute(runtimeDir)) {
    throw new Error(
      `XDG_RUNTIME_DIR is ${runtimeDir === undefined ? "unset" : JSON.stringify(runtimeDir)}; the service needs it to ` +
        "tell the app where it runs. Set XDG_RUNTIME_DIR to an absolute folder only you can use (usually /run/user/<uid>).",
    );
  }
  return join(runtimeDir, "wombat", "service.json");
};

/** A fresh random bearer token (at least 16 characters). */
export const newToken = (): string => randomBytes(32).toString("base64url");

/** Writes the file atomically: folder 0700, file 0600, looser existing modes tightened. */
export const writeDiscovery = (path: string, file: DiscoveryFile): void => {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
  chmodSync(dir, PRIVATE_DIR);
  // Renamed into place, so the app never reads a half-written file.
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(file)}\n`, { mode: PRIVATE_FILE, flag: "wx" });
    chmodSync(temp, PRIVATE_FILE);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

const readFile = (path: string): DiscoveryFile | undefined => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = DiscoveryFile.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Removes the file only if it still names `pid`; a missing file is fine. */
export const removeDiscovery = (path: string, pid: number): void => {
  // Another instance may have replaced a file it found stale; that one isn't ours to remove.
  if (readFile(path)?.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

/** The file's service, when it answers GET /version with the file's token; undefined when the file is stale or absent. */
export const findRunningService = async (
  path: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<DiscoveryFile | undefined> => {
  const file = readFile(path);
  if (file === undefined) return undefined;
  // A left-over file's port may now belong to another program; only the token proves it's the file's service.
  try {
    const response = await fetch(`http://127.0.0.1:${String(file.port)}/version`, {
      headers: { authorization: `Bearer ${file.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return response.status === 200 ? file : undefined;
  } catch {
    return undefined;
  }
};
