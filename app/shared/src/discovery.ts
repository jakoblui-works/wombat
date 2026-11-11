/// <reference types="node" />
// Node-only (it reads files and calls the service): the service and the app's main process use it, never a page.
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 2_000;

/** `$XDG_RUNTIME_DIR/wombat/service.json`: how the app finds the running service. Unknown fields are ignored. */
export const DiscoveryFile = z.object({
  apiVersion: z.int().positive(),
  port: z.int().min(1).max(65535),
  pid: z.int().positive(),
  token: z.string().min(1),
  /** The service's workspace root; services that predate it leave it out. */
  workspace: z.string().min(1).optional(),
});
export type DiscoveryFile = z.infer<typeof DiscoveryFile>;

/** `$XDG_RUNTIME_DIR/wombat/service.json`; throws when XDG_RUNTIME_DIR is unset or relative. */
export const discoveryPath = (env: NodeJS.ProcessEnv): string => {
  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (runtimeDir === undefined || !isAbsolute(runtimeDir)) {
    throw new Error(
      `XDG_RUNTIME_DIR is ${runtimeDir === undefined ? "unset" : JSON.stringify(runtimeDir)}; the service and the app ` +
        "need it to find each other. Set XDG_RUNTIME_DIR to an absolute folder only you can use (usually /run/user/<uid>).",
    );
  }
  return join(runtimeDir, "wombat", "service.json");
};

/** The discovery file at `path`; undefined when it's missing, unreadable or not a discovery file. */
export const readDiscovery = (path: string): DiscoveryFile | undefined => {
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

/** The file's service, when it answers GET /version with the file's token; undefined when the file is stale or absent. */
export const findRunningService = async (
  path: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<DiscoveryFile | undefined> => {
  const file = readDiscovery(path);
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
