// Finding the binders under an items root and the files that belong to each. A file belongs to the binder
// of the nearest folder above it that has a `_binder.yaml` or a `_structure.yaml` (broken settings included),
// and to no other: a binder's access level covers exactly its own files, so a nested hidden binder's items
// never show through its parent.
import { glob, lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, matchesGlob, posix, relative, sep } from "node:path";

import { errorCode, isMissing, isMissingPath } from "@wombat/shared/errno";
import { BinderSettings, type Problem, SETTINGS_FILE } from "@wombat/shared/items";
import { isCollection, LineCounter, parseDocument, type Document } from "yaml";

import { isWithin } from "../workspace.ts";

export { SETTINGS_FILE };
/** The settings file's former name: it still makes its folder a binder, whose settings are never read. */
export const OLD_SETTINGS_FILE = "_structure.yaml";

/** Dot folders (`.git`, drafts) and installed packages are never scanned. */
const skipped = (name: string) => name.startsWith(".") || name === "node_modules";

/** A path relative to the root with `/`; the root itself is "". */
export const toRootPath = (root: string, path: string) => relative(root, path).split(sep).join("/");

/** Joins root-relative paths, where "" is the root. */
export const joinRootPath = (folder: string, name: string) => (folder === "" ? name : `${folder}/${name}`);

/** What makes a folder unreadable, as a problem of the binder the folder belongs to. */
export const folderProblem = (folder: string, error: unknown): Problem => ({
  message: `folder: ${folder === "" ? "the items folder" : folder} can't be read (${errorCode(error)}); make it readable so its items load`,
});

export const oldSettingsProblem = (besideSettings: boolean): Problem => ({
  message: besideSettings
    ? `${OLD_SETTINGS_FILE}: delete this leftover file; ${SETTINGS_FILE} is the one read`
    : `${OLD_SETTINGS_FILE}: rename this file to ${SETTINGS_FILE}`,
});

/** A binder folder, root-relative, and which of the two settings files it directly holds (at least one). */
type BinderFolder = { path: string; settings: boolean; oldSettings: boolean };

const binderFolderOf = (path: string, fileNames: readonly string[]): BinderFolder | undefined => {
  const settings = fileNames.includes(SETTINGS_FILE);
  const oldSettings = fileNames.includes(OLD_SETTINGS_FILE);
  return settings || oldSettings ? { path, settings, oldSettings } : undefined;
};

/**
 * Every folder under `root` (itself included) that has a `_binder.yaml` or a `_structure.yaml`, sorted by
 * path, and the folders below the root that couldn't be read. A folder that vanished during the scan is
 * skipped; the root itself must be readable.
 */
export const binderFolders = async (root: string): Promise<{ folders: BinderFolder[]; unreadable: { folder: string; error: unknown }[] }> => {
  const folders: BinderFolder[] = [];
  const unreadable: { folder: string; error: unknown }[] = [];
  const visit = async (folder: string) => {
    let entries;
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true });
    } catch (error) {
      if (folder === "") throw new Error(`The items folder ${root} can't be read (${errorCode(error)}); make the folder readable, or choose another items folder in the app (Choose Items Folder… in the File menu), or set WOMBAT_ITEMS to another one when you run the service on its own.`, { cause: error });
      if (!isMissing(error)) unreadable.push({ folder, error });
      return;
    }
    const found = binderFolderOf(
      folder,
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    if (found !== undefined) folders.push(found);
    // Symlinked folders are not followed: they could lead out of the root.
    for (const entry of entries) {
      if (entry.isDirectory() && !skipped(entry.name)) await visit(joinRootPath(folder, entry.name));
    }
  };
  await visit("");
  return { folders: folders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), unreadable };
};

/** True for a path the scan never enters: one with a dot folder or node_modules in it, or a dot file. */
export const isSkippedPath = (path: string) => path.split("/").some(skipped);

/** True for a plain relative path: `/` between non-empty segments, none of them `.` or `..`, no backslash, not absolute. */
export const isPlainPath = (path: string) =>
  !isAbsolute(path) && !path.includes("\\") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const includeGlobs = (settings: BinderSettings) => (settings.include ?? []).map((pattern) => pattern.replace(/^(\.\/)+/, ""));

/** True when a folder-relative path matches one of a free binder's `include` globs. */
export const isIncluded = (settings: BinderSettings, path: string) => includeGlobs(settings).some((pattern) => matchesGlob(path, pattern));

/**
 * True when one of a free binder's `include` globs can match a file inside `folder` (folder-relative, plain): each
 * folder segment matches the glob's segment there, or the glob reaches a `**` first.
 */
export const includeReaches = (settings: BinderSettings, folder: string) =>
  includeGlobs(settings).some((pattern) => {
    const globSegments = pattern.split("/");
    for (const [index, segment] of folder.split("/").entries()) {
      const glob = globSegments[index];
      if (glob === "**") return true;
      // The glob's last segment names files, never a folder on the way.
      if (glob === undefined || index === globSegments.length - 1 || !matchesGlob(segment, glob)) return false;
    }
    return true;
  });

/** Whether the root-relative `path` is the folder `folder` or inside it; "" is the root, which holds everything. */
export const inFolder = (folder: string, path: string) => folder === "" || path === folder || path.startsWith(`${folder}/`);

/** The binder folder a root-relative file belongs to: the nearest of `folders` above it. */
export const ownerOf = (folders: Set<string>, file: string): string | undefined => {
  const parts = file.split("/").slice(0, -1);
  for (let length = parts.length; length >= 0; length -= 1) {
    const folder = parts.slice(0, length).join("/");
    if (folders.has(folder)) return folder;
  }
  return undefined;
};

export type SettingsResult = { settings: BinderSettings; problems: [] } | { settings: null; problems: Problem[] };

/** The line of the deepest node of `path` the document has. */
const lineOf = (doc: Document, lineCounter: LineCounter, path: PropertyKey[]) => {
  let node: unknown = doc.contents;
  let offset = doc.contents?.range?.[0];
  for (const key of path) {
    if (!isCollection(node)) break;
    const child: unknown = node.get(key, true);
    const range = (child as { range?: [number, number, number] } | undefined)?.range;
    if (range === undefined) break;
    node = child;
    offset = range[0];
  }
  return offset === undefined ? undefined : lineCounter.linePos(offset).line;
};

/** Parses and validates one `_binder.yaml`; a problem's `field` is the zod path joined with `.`. */
export const readSettings = async (file: string): Promise<SettingsResult> => {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = errorCode(error);
    return { settings: null, problems: [{ message: `${SETTINGS_FILE}: can't be read (${code}); check the file's permissions` }] };
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const [error] = doc.errors;
  if (error !== undefined) {
    const line = error.linePos?.[0].line;
    const message = `${SETTINGS_FILE}: ${(error.message.split("\n")[0] ?? "").replace(/:$/, "")}; fix the YAML so the binder loads`;
    return { settings: null, problems: [{ ...(line === undefined ? {} : { line }), message }] };
  }
  const result = BinderSettings.safeParse(doc.toJS());
  if (result.success) return { settings: result.data, problems: [] };
  return {
    settings: null,
    problems: result.error.issues.map((issue) => {
      const line = lineOf(doc, lineCounter, issue.path);
      return {
        ...(issue.path.length === 0 ? {} : { field: issue.path.join(".") }),
        ...(line === undefined ? {} : { line }),
        message: issue.message,
      };
    }),
  };
};

/**
 * True when a folder on the way from `folder` to `file` (both absolute, the file inside) is a symlink. Throws
 * ENOENT when one of the folders doesn't exist.
 */
export const throughSymlink = async (folder: string, file: string) => {
  const segments = relative(folder, file).split(sep).slice(0, -1);
  let path = folder;
  for (const segment of segments) {
    path = join(path, segment);
    if ((await lstat(path)).isSymbolicLink()) return true;
  }
  return false;
};

/**
 * Whether the binder in `folder` reads the root-relative `path`, a regular file not reached through a symlink,
 * as one of its items: `*.md` directly in its folder (`naming: handle`), or an `include` match of its own
 * (`naming: free`). Never a dot file, nor anything under a dot folder or node_modules.
 */
export const readsAsItem = (settings: BinderSettings, folder: string, path: string, folders: Set<string>) => {
  const inner = folder === "" ? path : path.slice(folder.length + 1);
  if (!inFolder(folder, path) || !inner.endsWith(".md") || isSkippedPath(inner)) return false;
  if (settings.naming === "handle" || settings.include === undefined) return !inner.includes("/");
  return isIncluded(settings, inner) && ownerOf(folders, path) === folder;
};

/**
 * Whether the catalog under `root` reads the file at `path` (absolute, symlinks resolved) as a binder's
 * `_binder.yaml` (or `_structure.yaml`) or an item's file, as it is now or once a file is written there: files
 * only the item tools may change. A binder whose settings don't load reads no items; a root that is gone holds none.
 */
export const isCatalogFile = async (root: string, path: string): Promise<boolean> => {
  let realRoot;
  try {
    realRoot = await realpath(root);
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
  if (path === realRoot || !isWithin(realRoot, path)) return false;
  const rootPath = toRootPath(realRoot, path);
  if (isSkippedPath(rootPath)) return false;
  const name = posix.basename(rootPath);
  if (name === SETTINGS_FILE || name === OLD_SETTINGS_FILE) return true;
  const found = (await binderFolders(realRoot)).folders;
  const folders = new Set(found.map((folder) => folder.path));
  const owner = ownerOf(folders, rootPath);
  if (owner === undefined || found.find((folder) => folder.path === owner)?.settings !== true) return false;
  const { settings } = await readSettings(join(realRoot, owner, SETTINGS_FILE));
  return settings !== null && readsAsItem(settings, owner, rootPath, folders);
};

export type BinderFiles = { files: string[]; problems: Problem[] };

/**
 * A binder's files, root-relative and sorted: `*.md` directly in its folder (`naming: handle`) or its
 * `include` matches (`naming: free`). Only regular `.md` files count that belong to no binder nested deeper
 * and aren't under a dot folder or node_modules. Symlinks are never followed, files or folders, as in the scan
 * for binders: a symlink could lead out of the folder, or make one file two items. A binder folder that
 * vanished lists no files; one that can't be read lists none, with a problem.
 */
export const binderFiles = async (root: string, folder: string, settings: BinderSettings, folders: Set<string>): Promise<BinderFiles> => {
  const absolute = join(root, folder);
  const failed = (error: unknown): BinderFiles => ({ files: [], problems: isMissing(error) ? [] : [folderProblem(folder, error)] });
  if (settings.naming === "handle" || settings.include === undefined) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      return failed(error);
    }
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => joinRootPath(folder, entry.name))
      .filter((path) => readsAsItem(settings, folder, path, folders))
      .sort();
    return { files, problems: [] };
  }
  const files = new Set<string>();
  try {
    for await (const match of glob(settings.include, { cwd: absolute })) {
      const path = match.split(sep).join("/");
      const rootPath = joinRootPath(folder, path);
      if (!readsAsItem(settings, folder, rootPath, folders)) continue;
      const file = join(absolute, match);
      if (relative(absolute, file).startsWith("..")) continue;
      try {
        if (!(await lstat(file)).isFile() || (await throughSymlink(absolute, file))) continue;
      } catch {
        // Gone since the glob saw it.
        continue;
      }
      files.add(rootPath);
    }
  } catch (error) {
    return failed(error);
  }
  return { files: [...files].sort(), problems: [] };
};
