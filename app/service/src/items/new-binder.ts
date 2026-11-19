// A new binder: the starter settings file it begins with, and the checks its folder and settings pass before the
// starter is written. Nothing here writes; the Writer writes the starter in the root's write queue.
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { isMissingPath } from "@wombat/shared/errno";
import { BinderSettings, slugOf } from "@wombat/shared/items";
import { parse, stringify } from "yaml";

import type { LoadedBinder, NamedProblem, ValidBinder } from "./catalog.ts";
import { binderFiles, includeReaches, isPlainPath, isSkippedPath, OLD_SETTINGS_FILE, ownerOf, SETTINGS_FILE } from "./binders.ts";

export type NewBinder = { path: string; name: string; prefix: string; adopt?: boolean | undefined };

const starter = (name: string, prefix: string) => ({
  version: 1,
  id: slugOf(name),
  name,
  prefix,
  access: "read",
  views: [{ name: "List", kind: "list" }],
});

/** The `_binder.yaml` a new binder starts with: id (the name's slug), name, prefix, read access and one list view. */
export const starterSettings = (name: string, prefix: string): string => stringify(starter(name, prefix), { lineWidth: 0 });

const binderName = (binder: ValidBinder) => `${binder.settings.name} (${binder.path === "" ? "the items folder" : binder.path})`;

/** The starter's own problems, as `BinderSettings` finds them: the id's at `name`, since the id is made from it. */
const settingsProblems = (name: string, text: string): NamedProblem[] => {
  const result = BinderSettings.safeParse(parse(text));
  if (result.success) return [];
  const problems = result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? "name"), message: issue.message }));
  const others = problems.filter((problem) => problem.field !== "id");
  // An empty name has its own problem; the id made from it needs none besides.
  if (others.length === problems.length || others.some((problem) => problem.field === "name")) return others;
  const id = slugOf(name);
  const message =
    id === ""
      ? `name: ${JSON.stringify(name)} has no letters or digits to make the binder's id from; use a name with letters, like Team Chores`
      : `name: makes the id "${id}", but an id starts with a lowercase letter and has at most 40 characters; start the name with a letter, or shorten it`;
  return [...others, { field: "name", message }];
};

/** The problems with an id or prefix another binder (hidden ones included) already has. */
const takenProblems = (binders: readonly LoadedBinder[], id: string, prefix: string): NamedProblem[] => {
  const valid = binders.filter((binder): binder is ValidBinder => binder.id !== null);
  const byId = valid.find((binder) => binder.id === id);
  const byPrefix = valid.find((binder) => binder.settings.prefix === prefix);
  return [
    ...(byId === undefined ? [] : [{ field: "name", message: `name: makes the id "${id}", which the binder ${binderName(byId)} already has; pick another name` }]),
    ...(byPrefix === undefined ? [] : [{ field: "prefix", message: `prefix: ${prefix} is the prefix of the binder ${binderName(byPrefix)}; pick another prefix` }]),
  ];
};

const exists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
};

/**
 * The problems of `path` (root-relative) as a new binder's folder: a plain path the scan reads, through real folders,
 * not already a binder, and not inside a free binder whose include reaches it (the files there are that binder's).
 */
const pathProblems = async (root: string, path: string, binders: readonly LoadedBinder[]): Promise<NamedProblem[]> => {
  const problem = (message: string, names?: string[]): NamedProblem[] => [{ field: "path", message: `path: ${message}`, ...(names === undefined ? {} : { names: { binders: names } }) }];
  if (!isPlainPath(path)) return problem(`${path === "" ? "give the new binder's folder" : `${path} must be a folder`} relative to the items folder, with / and without "..", like ops/team-chores`);
  if (isSkippedPath(path)) return problem(`${path} is in a dot folder or node_modules, which are never read; pick another folder`);
  const segments = path.split("/");
  for (let length = 1; length <= segments.length; length += 1) {
    const folder = segments.slice(0, length).join("/");
    let stats;
    try {
      stats = await lstat(join(root, folder));
    } catch (error) {
      if (isMissingPath(error)) break;
      throw error;
    }
    if (stats.isSymbolicLink()) return problem(`${folder} is a symlink, which is never read; pick a path through real folders`);
    if (!stats.isDirectory()) return problem(`${folder} is a file, not a folder; pick another folder`);
  }
  if (await exists(join(root, path, SETTINGS_FILE))) return problem(`${path} already holds a ${SETTINGS_FILE}, so it's a binder already; pick another folder`);
  if (await exists(join(root, path, OLD_SETTINGS_FILE))) {
    return problem(`${path} already holds a ${OLD_SETTINGS_FILE} (a binder's settings under their former name); rename it to ${SETTINGS_FILE} and edit it, or pick another folder`);
  }
  const owner = ownerOf(new Set(binders.map((binder) => binder.path)), `${path}/${SETTINGS_FILE}`);
  const enclosing = binders.find((binder): binder is ValidBinder => binder.path === owner && binder.id !== null);
  if (enclosing?.settings.naming === "free" && includeReaches(enclosing.settings, enclosing.path === "" ? path : path.slice(enclosing.path.length + 1))) {
    return problem(`${path} is inside the binder ${binderName(enclosing)}, whose include reaches it; pick a folder its include doesn't reach`, [enclosing.id]);
  }
  return [];
};

/**
 * Markdown files already in the folder would become the new binder's items on the next read, which writes an id and
 * a handle into each: refused until the caller says to adopt them.
 */
const adoptProblems = async (root: string, path: string, binders: readonly LoadedBinder[]): Promise<NamedProblem[]> => {
  const folders = new Set([...binders.map((binder) => binder.path), path]);
  const { files } = await binderFiles(root, path, BinderSettings.parse(starter("Adopted", "A")), folders);
  if (files.length === 0) return [];
  const count = files.length === 1 ? "1 Markdown file" : `${files.length} Markdown files`;
  return [{ field: "adopt", message: `adopt: ${path} holds ${count}; the new binder makes them its items and writes an id and a handle into each. Create it anyway, or pick an empty folder.` }];
};

/** The starter to write at `<path>/_binder.yaml`, or every problem that keeps it from being written. */
export const checkNewBinder = async (root: string, binders: readonly LoadedBinder[], { path, name, prefix, adopt }: NewBinder): Promise<{ problems: NamedProblem[]; text: string; id: string }> => {
  const text = starterSettings(name, prefix);
  const own = settingsProblems(name, text);
  const id = slugOf(name);
  const taken = takenProblems(binders, id, prefix).filter((problem) => !own.some((other) => other.field === problem.field));
  const problems = [...own, ...taken, ...(await pathProblems(root, path, binders))];
  if (problems.length > 0 || adopt === true) return { problems, text, id };
  return { problems: await adoptProblems(root, path, binders), text, id };
};
