// Finding the structures under an items root and the files that belong to each. A file belongs to the structure
// of the nearest folder above it that has a `_structure.yaml` (broken settings included), and to no other:
// a structure's access level covers exactly its own files, so a nested hidden structure's items never show
// through its parent.
import { glob, lstat, readdir, readFile } from "node:fs/promises";
import { join, matchesGlob, relative, sep } from "node:path";

import { StructureSettings, type Problem } from "@wombat/shared/items";
import { isCollection, LineCounter, parseDocument, type Document } from "yaml";

import { errorCode, isMissing } from "../errno.ts";

export const SETTINGS_FILE = "_structure.yaml";

/** Dot folders (`.git`, drafts) and installed packages are never scanned. */
const skipped = (name: string) => name.startsWith(".") || name === "node_modules";

/** A path relative to the root with `/`; the root itself is "". */
export const toRootPath = (root: string, path: string) => relative(root, path).split(sep).join("/");

/** Joins root-relative paths, where "" is the root. */
export const joinRootPath = (folder: string, name: string) => (folder === "" ? name : `${folder}/${name}`);

/** What makes a folder unreadable, as a problem of the structure the folder belongs to. */
export const folderProblem = (folder: string, error: unknown): Problem => ({
  message: `folder: ${folder === "" ? "the items root" : folder} can't be read (${errorCode(error)}); make it readable so its items load`,
});

/**
 * Every folder under `root` (itself included) that has a `_structure.yaml`, root-relative and sorted, and the
 * folders below the root that couldn't be read. A folder that vanished during the scan is skipped; the root
 * itself must be readable.
 */
export const structureFolders = async (root: string): Promise<{ folders: string[]; unreadable: { folder: string; error: unknown }[] }> => {
  const folders: string[] = [];
  const unreadable: { folder: string; error: unknown }[] = [];
  const visit = async (folder: string) => {
    let entries;
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true });
    } catch (error) {
      if (folder === "") throw new Error(`The items root ${root} can't be read (${errorCode(error)}); check WOMBAT_ITEMS and the folder's permissions.`, { cause: error });
      if (!isMissing(error)) unreadable.push({ folder, error });
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === SETTINGS_FILE)) folders.push(folder);
    // Symlinked folders are not followed: they could lead out of the root.
    for (const entry of entries) {
      if (entry.isDirectory() && !skipped(entry.name)) await visit(joinRootPath(folder, entry.name));
    }
  };
  await visit("");
  return { folders: folders.sort(), unreadable };
};

/** True for a path the scan never enters: one with a dot folder or node_modules in it, or a dot file. */
export const isSkippedPath = (path: string) => path.split("/").some(skipped);

/** True when a folder-relative path matches one of a free structure's `include` globs. */
export const isIncluded = (settings: StructureSettings, path: string) =>
  (settings.include ?? []).some((pattern) => matchesGlob(path, pattern.replace(/^(\.\/)+/, "")));

/** Whether the root-relative `path` is the folder `folder` or inside it; "" is the root, which holds everything. */
export const inFolder = (folder: string, path: string) => folder === "" || path === folder || path.startsWith(`${folder}/`);

/** The structure folder a root-relative file belongs to: the nearest of `folders` above it. */
export const ownerOf = (folders: Set<string>, file: string): string | undefined => {
  const parts = file.split("/").slice(0, -1);
  for (let length = parts.length; length >= 0; length -= 1) {
    const folder = parts.slice(0, length).join("/");
    if (folders.has(folder)) return folder;
  }
  return undefined;
};

export type SettingsResult = { settings: StructureSettings; problems: [] } | { settings: null; problems: Problem[] };

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

/** Parses and validates one `_structure.yaml`; a problem's `field` is the zod path joined with `.`. */
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
    const message = `${SETTINGS_FILE}: ${(error.message.split("\n")[0] ?? "").replace(/:$/, "")}; fix the YAML so the structure loads`;
    return { settings: null, problems: [{ ...(line === undefined ? {} : { line }), message }] };
  }
  const result = StructureSettings.safeParse(doc.toJS());
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

export type StructureFiles = { files: string[]; problems: Problem[] };

/**
 * A structure's files, root-relative and sorted: `*.md` directly in its folder (`naming: handle`) or its
 * `include` matches (`naming: free`). Only regular `.md` files count that belong to no structure nested deeper
 * and aren't under a dot folder or node_modules. Symlinks are never followed, files or folders, as in the scan
 * for structures: a symlink could lead out of the folder, or make one file two items. A structure folder that
 * vanished lists no files; one that can't be read lists none, with a problem.
 */
export const structureFiles = async (root: string, folder: string, settings: StructureSettings, folders: Set<string>): Promise<StructureFiles> => {
  const absolute = join(root, folder);
  const failed = (error: unknown): StructureFiles => ({ files: [], problems: isMissing(error) ? [] : [folderProblem(folder, error)] });
  if (settings.naming === "handle" || settings.include === undefined) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      return failed(error);
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
      .map((entry) => joinRootPath(folder, entry.name))
      .sort();
    return { files, problems: [] };
  }
  const files = new Set<string>();
  try {
    for await (const match of glob(settings.include, { cwd: absolute })) {
      const path = match.split(sep).join("/");
      if (!path.endsWith(".md") || isSkippedPath(path)) continue;
      const file = join(absolute, match);
      if (relative(absolute, file).startsWith("..")) continue;
      try {
        if (!(await lstat(file)).isFile() || (await throughSymlink(absolute, file))) continue;
      } catch {
        // Gone since the glob saw it.
        continue;
      }
      const rootPath = joinRootPath(folder, path);
      if (ownerOf(folders, rootPath) === folder) files.add(rootPath);
    }
  } catch (error) {
    return failed(error);
  }
  return { files: [...files].sort(), problems: [] };
};
