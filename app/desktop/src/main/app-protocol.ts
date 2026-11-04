import { realpath, stat } from "node:fs/promises";
import path from "node:path";

// The built renderer is served from `app://wombat/`, a fixed origin of the app's own, instead
// of file:// (which would put every file on the disk one navigation away).
export const APP_SCHEME = "app";
export const APP_HOST = "wombat";
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

// Node's URL gives non-special schemes an opaque origin ("null"), so compare scheme and host.
export const isAppOrigin = (url: string): boolean => {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === APP_HOST &&
    parsed.username === "" &&
    parsed.password === ""
  );
};

const isInside = (root: string, target: string): boolean => target.startsWith(root + path.sep);

// The file under `root` that an app:// URL names, or null for anything else: another host,
// a path that escapes `root` (`..`, encoded or not, or a symlink pointing out), a malformed
// escape, or something that isn't a regular file.
export const resolveAppFile = async (root: string, url: string): Promise<string | null> => {
  const parsed = URL.parse(url);
  if (parsed === null || !isAppOrigin(url)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, `.${decoded}`);
  if (!isInside(rootPath, target)) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(target)]);
    if (!isInside(realRoot, realTarget)) return null;
    return (await stat(realTarget)).isFile() ? realTarget : null;
  } catch {
    return null;
  }
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export const contentType = (file: string): string =>
  CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
