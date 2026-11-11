// Creating, changing and deleting item files. Each write runs in the root's write queue on a fresh read of the
// root, is refused when the file changed since the version the caller read, and is parsed again before it's
// written: a write either reads back exactly as intended or doesn't happen. Updates touch only the bytes of the
// fields they set, so comments, key order and line endings stay as they were typed.
import { randomUUIDv7 } from "node:crypto";
import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { ItemWriteErrorCode } from "@wombat/shared/api";
import { ITEM_FIELDS, OWN_KEYS, type Problem, type StructureSettings } from "@wombat/shared/items";
import { stringify } from "yaml";

import type { Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { findByHandle, isClash, loadItem, readRoot, type LoadedItem, type LoadedStructure, type NamedProblem, type ProblemNames, type RootRead, type ValidStructure } from "./catalog.ts";
import { isAlreadyThere, isMissingPath } from "./errno.ts";
import { NoHardLinks, queueWrite, readAtVersion, removeUnchanged, VersionChanged, versionOf, writeAtomic, type VersionedFile } from "./files.ts";
import { bodyEdit, checkedText, parseItemFile, readsBackAs, setKeyEdits, titleEdit, type ParsedItemFile } from "./item-file.ts";
import { inFolder, isIncluded, isSkippedPath, joinRootPath, SETTINGS_FILE, throughSymlink } from "./structures.ts";
import { formatHandle, setOwn, validateProperties, type LinkLookup } from "./validate.ts";

/**
 * Why a write was refused; nothing on disk changed. The message is for people and may show root-relative paths;
 * an agent never gets an `invalid_fields` message, only the problems, which keep their `names` (the catalog's
 * included) for access.ts to decide from. So every `invalid_fields` refusal says what went wrong in its problems.
 */
export class ItemWriteError extends Error {
  readonly code: ItemWriteErrorCode;
  readonly problems: NamedProblem[];

  constructor(code: ItemWriteErrorCode, message: string, problems: NamedProblem[] = []) {
    super(message);
    this.name = "ItemWriteError";
    this.code = code;
    this.problems = problems;
  }
}

export type NewItem = {
  title: string;
  body: string;
  properties: Record<string, unknown>;
  /** Free naming only: the file's path relative to the structure's folder, with `/`. */
  file?: string;
};

export type Writer = {
  createItem(structureId: string, item: NewItem): Promise<LoadedItem>;
  /** One or more fields, title and body included; refused when the file changed since `baseVersion`. */
  updateItem(handle: string, fields: Record<string, unknown>, baseVersion: string): Promise<LoadedItem>;
  /** The handle's number stays taken: the store's counter never goes back. */
  deleteItem(handle: string, baseVersion: string): Promise<void>;
  /**
   * The problems of `file` as a new item's path in a free-named structure, without writing anything. A path in
   * one of `unseen` (folders relative to the root) gets the problem of a folder that doesn't exist.
   */
  checkNewFile(structureId: string, file: unknown, unseen?: readonly string[]): Promise<NamedProblem[]>;
  /**
   * A dry run of `change`: the write's own checks, run by the same code on a fresh read of the root, in the
   * root's write queue. Resolves when the write would go through as of now, and throws the ItemWriteError the
   * write would throw otherwise. It writes nothing (no file, no temp file) and takes no handle number. A create's
   * `unseen` folders read as missing, as in `checkNewFile`. A write made later still checks everything again: a
   * file can change in between.
   */
  check(change: ItemChange): Promise<void>;
};

/** A change as `check` takes it: the arguments of createItem, updateItem or deleteItem. */
export type ItemChange =
  | { kind: "create"; structureId: string; item: NewItem; unseen?: readonly string[] }
  | { kind: "update"; handle: string; fields: Record<string, unknown>; baseVersion: string }
  | { kind: "delete"; handle: string; baseVersion: string };

export type WriterOptions = { root: string; store: Store; log?: Log };

const SLUG_LENGTH = 50;

/** Lowercase ASCII words of the title joined by `-`, cut at a word to at most 50 characters. */
export const slugOf = (title: string) => {
  const words = title.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let slug = "";
  for (const word of words) {
    const next = slug === "" ? word : `${slug}-${word}`;
    if (next.length > SLUG_LENGTH) return slug === "" ? word.slice(0, SLUG_LENGTH) : slug;
    slug = next;
  }
  return slug;
};

/** A value as one line of YAML that reads back as the same value. */
const yamlValue = (value: unknown) => {
  const text = stringify(value, { lineWidth: 0 }).replace(/\n$/, "");
  // Multi-line strings would become block scalars; a JSON string is a one-line YAML double-quoted scalar.
  return text.includes("\n") ? JSON.stringify(value) : text;
};

const invalid = (message: string, problems: NamedProblem[]) => new ItemWriteError(ItemWriteErrorCode.enum.invalid_fields, message, problems);

/** The problems' messages, for an error message. */
export const listed = (problems: readonly Problem[]) => problems.map((problem) => problem.message).join("; ");

/** The property values a new item is given: a null or undefined value means the property is absent. */
export const presentValues = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null));

const refuseOwnKeys = (keys: string[], what: string) => {
  const own = keys.filter((key) => OWN_KEYS.has(key));
  if (own.length > 0) {
    throw new ItemWriteError(
      ItemWriteErrorCode.enum.field_not_writable,
      `${own.join(", ")}: the service sets ${own.length === 1 ? "this field" : "these fields"}, so ${what} can't; leave ${own.length === 1 ? "it" : "them"} out (a handle changes only by hand, with the old one kept in aliases).`,
    );
  }
};

/**
 * A write refused for the structure's own problems (its settings), not the item's: `invalid_fields` like any other.
 * The problems are the catalog's, with the `names` of the other structures they name; the message lists them.
 */
export class StructureProblemsError extends ItemWriteError {
  constructor(message: string, problems: NamedProblem[]) {
    super(ItemWriteErrorCode.enum.invalid_fields, message, problems);
    this.name = "StructureProblemsError";
  }
}

/** Problems of a title: one line of text, not empty. Returns the title as it reads back (trimmed). */
const checkTitle = (title: unknown): { title: string; problems: NamedProblem[] } => {
  if (typeof title !== "string") return { title: "", problems: [{ field: "title", message: "title: takes text, like Login times out" }] };
  if (/[\r\n\u2028\u2029]/.test(title)) return { title, problems: [{ field: "title", message: "title: takes one line; move the rest into the body" }] };
  const trimmed = title.trim();
  return { title: trimmed, problems: trimmed === "" ? [{ field: "title", message: "title: can't be empty; give the item a title" }] : [] };
};

const checkBody = (body: unknown): NamedProblem[] => (typeof body === "string" ? [] : [{ field: "body", message: "body: takes text (an empty body is \"\")" }]);

/** The structure with settings and the id `id` in a fresh read, or `structure_not_found`. */
const writableStructureById = (read: RootRead, id: string) => {
  const structure = read.snapshot.structures.find((candidate): candidate is ValidStructure => candidate.id === id);
  if (structure === undefined) {
    throw new ItemWriteError(ItemWriteErrorCode.enum.structure_not_found, `No structure has the id ${id}; use the id from its ${SETTINGS_FILE} (a structure with broken settings has none until it's fixed).`);
  }
  return structure;
};

/** A structure items can be written to: one with settings and no problems. */
const writableStructure = (structure: ValidStructure, action: string) => {
  if (structure.problems.length > 0) {
    throw new StructureProblemsError(
      `The structure ${structure.id} has problems (${listed(structure.problems)}), so no item in it can be ${action}; fix its ${SETTINGS_FILE} first.`,
      structure.problems,
    );
  }
};

/**
 * D15: a problem of a declared property's value, which a write may leave in place (and fix). Every other problem
 * (a duplicate id, handle or alias, no title, an unparseable file, an undeclared key) is about the item's identity.
 */
const isValueProblem = (settings: StructureSettings, problem: NamedProblem) =>
  problem.field !== undefined && Object.hasOwn(settings.properties, problem.field);

/**
 * D15, compared by field: the problems a write adds, on a field it sets or on a field that had none before. A
 * problem that names no field is always added.
 */
const addedProblems = (before: NamedProblem[], after: NamedProblem[], set: readonly string[]) => {
  const had = new Set(before.map((problem) => problem.field));
  return after.filter((problem) => problem.field === undefined || set.includes(problem.field) || !had.has(problem.field));
};

/**
 * The property values to write, with link values given as a handle or alias replaced by the target's id (links
 * store ids). Throws `invalid_fields` when the item's frontmatter `data` with them gets a problem it didn't have
 * (`before`, the item's value problems): on a field the write sets, or on one that was fine.
 */
const checkProperties = (structure: ValidStructure, data: Record<string, unknown>, set: string[], links: LinkLookup, extra: NamedProblem[], before: NamedProblem[] = []) => {
  const validated = validateProperties(structure.settings, data, links);
  const problems = [...extra, ...addedProblems(before, validated.problems, set)];
  if (problems.length > 0) throw invalid(`The fields don't fit the structure ${structure.id}: ${listed(problems)}. Nothing was written.`, problems);
  const values = { ...data };
  for (const key of set) {
    const id = validated.rewrites.get(key);
    if (id !== undefined) setOwn(values, key, id);
  }
  return values;
};

/** The item as written, from its text, with the value problems it kept (D15); the write checked that it parses. */
const loadedItem = (structure: ValidStructure, path: string, text: string, links: LinkLookup): LoadedItem =>
  loadItem(structure, path, parseItemFile(text) as ParsedItemFile, versionOf(Buffer.from(text, "utf8")), links).item;

const missingFolder = (file: string) => `the folder of ${file} doesn't exist; create it first or pick an existing folder`;

/** Problems of a free structure's `file`, checked like a file someone made by hand; `unseen` folders read as missing. */
const checkFreeFile = async (root: string, structure: ValidStructure, file: unknown, structures: LoadedStructure[], unseen: readonly string[] = []): Promise<NamedProblem[]> => {
  const problem = (message: string, names?: ProblemNames): NamedProblem[] => [{ field: "file", message: `file: ${message}`, ...(names === undefined ? {} : { names }) }];
  if (typeof file !== "string" || file === "") return problem(`${structure.id} names files freely, so give the new file's path in its folder, like notes.md`);
  const segments = file.split("/");
  if (isAbsolute(file) || file.includes("\\") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return problem(`${file} must be a plain path relative to the structure's folder, with / and without "..", like guides/setup.md`);
  }
  if (!file.endsWith(".md")) return problem(`${file} must end in .md`);
  if (isSkippedPath(file)) return problem(`${file} is in a dot folder or node_modules, or is a dot file, which are never read; pick another path`);
  if (!isIncluded(structure.settings, file)) {
    return problem(`${file} doesn't match the structure's include (${(structure.settings.include ?? []).join(", ")}); pick a path it matches`);
  }
  const rootPath = joinRootPath(structure.path, file);
  // A folder on the way from this structure's folder to the file; a folder named like the file itself isn't.
  const between = (folder: string) => folder !== structure.path && folder !== rootPath && inFolder(structure.path, folder) && inFolder(folder, rootPath);
  // The first structure folder met on the way decides, as it's where the path stops being this structure's: a
  // hidden one reads like a folder that doesn't exist, a visible one is another structure's. Past that folder
  // nothing is looked at, so a hidden folder inside a visible one answers as that visible one does.
  const first = [...structures.map((candidate) => candidate.path), ...unseen].filter(between).sort((a, b) => a.length - b.length)[0];
  if (first !== undefined) {
    if (unseen.includes(first)) return problem(missingFolder(file));
    const names = { structures: structures.flatMap((candidate) => (candidate.path === first && candidate.id !== null ? [candidate.id] : [])) };
    return problem(`${file} is inside another structure's folder; create it there instead`, names);
  }
  const folder = join(root, structure.path);
  const absolute = join(root, rootPath);
  try {
    if (await throughSymlink(folder, absolute)) return problem(`${file} goes through a symlinked folder, which is never read; pick a path in a real folder`);
  } catch (error) {
    if (isMissingPath(error)) return problem(missingFolder(file));
    throw error;
  }
  try {
    await lstat(absolute);
    return problem(`${file} already exists; pick another path, or update that item`);
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  return [];
};

/**
 * The item named by a handle (or alias) in a fresh read, if it can be written (D15), with its file as it is now:
 * an update needs an item whose only problems are property values; a delete needs a file that parses and a handle
 * no other file has. Both need the file still at `baseVersion`.
 */
const writableItem = async (root: string, read: RootRead, handle: string, baseVersion: string, action: "updated" | "deleted") => {
  const { items, structures } = read.snapshot;
  const item = findByHandle(items, handle);
  if (item === undefined) throw new ItemWriteError(ItemWriteErrorCode.enum.item_not_found, `No item has the handle ${handle}; check it, or list the structure's items to find the right one.`);
  const structure = structures.find((candidate): candidate is ValidStructure => candidate.id === item.structure);
  if (structure === undefined) throw new Error(`The item ${handle} was read in the structure ${item.structure}, which the same read doesn't list.`);
  // A handle other files share is refused before the version: which file the caller read can't be told, so
  // stale_version would send it round a re-read loop it can't leave.
  const shared = item.problems.filter(isClash);
  if (shared.length > 0) {
    throw invalid(`${handle} names more than one file (${listed(shared)}), so it can't be ${action}; fix the handles by hand first.`, shared);
  }
  const stale = () =>
    new ItemWriteError(ItemWriteErrorCode.enum.stale_version, `${handle} changed since it was read (by hand or by another write), so it wasn't ${action}; read it again and redo the change on the new version.`);
  let current: VersionedFile;
  try {
    // Read again rather than trust the full read above: it took a while, and a hand edit may have landed since.
    current = await readAtVersion(join(root, item.path), baseVersion);
  } catch (error) {
    if (!(error instanceof VersionChanged)) throw error;
    throw stale();
  }
  // The item's problems and id below come from the full read, so it must have seen these very bytes: a file that
  // changed and changed back (A-B-A) is at the base again, but the full read judged the version in between.
  if (item.version !== current.version) throw stale();
  writableStructure(structure, action);
  const blocking = action === "updated" ? item.problems.filter((problem) => !isValueProblem(structure.settings, problem)) : [];
  if (blocking.length > 0 || item.handle === null) {
    const problems = blocking.length > 0 ? blocking : item.problems;
    const said = problems.length > 0 ? problems : [{ message: "handle: none yet; it's assigned once the file's problems are fixed by hand" }];
    throw invalid(`${handle} has problems on disk (${listed(said)}), so it can't be ${action}; fix the file (${item.path}) by hand first.`, said);
  }
  if (action === "updated" && item.id === null) {
    throw invalid(`${handle} has no id yet, so it can't be ${action}; read its structure so it gets one, then try again.`, [
      { field: "id", message: "id: none yet; reading the structure assigns one" },
    ]);
  }
  return { item, structure, current };
};

/** Runs a write, turning a version change found just before it landed into `stale_version`. */
const staleIfChanged = async (handle: string, action: string, write: () => Promise<void>) => {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof VersionChanged)) throw error;
    throw new ItemWriteError(ItemWriteErrorCode.enum.stale_version, `${handle} changed while it was being ${action} (by hand or by another program), so it wasn't; read it again and redo the change.`);
  }
};

// The checks of each change, shared by the write and its dry run (`check`): each reads the root afresh, throws the
// refusal, and returns what the write needs. None of them writes or takes a handle number.

const checkCreate = async (root: string, structureId: string, item: NewItem, unseen: readonly string[] = []) => {
  refuseOwnKeys(Object.keys(item.properties), "a new item's properties");
  const read = await readRoot(root);
  const structure = writableStructureById(read, structureId);
  writableStructure(structure, "created");
  const { settings } = structure;

  const { title, problems: titleProblems } = checkTitle(item.title);
  const problems = [...titleProblems, ...checkBody(item.body)];
  if (settings.naming === "free") problems.push(...(await checkFreeFile(root, structure, item.file, read.snapshot.structures, unseen)));
  else if (item.file !== undefined) problems.push({ field: "file", message: `file: ${structure.id} names its files by handle, so leave file out` });
  const given = presentValues(item.properties);
  // Declared order, then anything undeclared (which validation refuses), so files read like their settings.
  const keys = [
    ...Object.keys(settings.properties).filter((key) => Object.hasOwn(given, key)),
    ...Object.keys(given).filter((key) => !Object.hasOwn(settings.properties, key)),
  ];
  const values = checkProperties(structure, Object.fromEntries(keys.map((key) => [key, given[key]])), keys, read.links, problems);

  const textFor = (id: string, handle: string) => {
    const lines = [`id: ${id}`, `handle: ${handle}`, ...keys.map((key) => `${key}: ${yamlValue(values[key])}`)];
    const text = `---\n${lines.join("\n")}\n---\n# ${title}\n${item.body}`;
    return readsBackAs(text, { data: { id, handle, ...values }, title, body: item.body }) ? text : undefined;
  };
  // Checked with stand-in values before the number is taken, so a refused create takes no number.
  if (textFor(randomUUIDv7(), formatHandle(settings.prefix, 1)) === undefined) {
    throw invalid("The item wouldn't read back as given; check the title and the property values for characters YAML or markdown treat specially.", [
      { message: "item: wouldn't read back as given; check the title and the property values for characters YAML or markdown treat specially" },
    ]);
  }
  return { read, structure, title, textFor };
};

const checkUpdate = async (root: string, handle: string, fields: Record<string, unknown>, baseVersion: string) => {
  const names = Object.keys(fields);
  refuseOwnKeys(names, "an update");
  if (names.length === 0) throw invalid("The update names no fields; give at least one field to change.", [{ message: "fields: none given; give at least one field to change" }]);
  const read = await readRoot(root);
  const { item, structure, current } = await writableItem(root, read, handle, baseVersion, "updated");
  const parsed = parseItemFile(current.text);
  // The file is at the base version and the full read saw these same bytes without a parse problem, so it parses.
  if (!parsed.ok) throw new ItemWriteError(ItemWriteErrorCode.enum.stale_version, `${handle} changed since it was read, so it wasn't updated; read it again and redo the change.`);

  const problems: NamedProblem[] = [];
  let title = parsed.title;
  let body = parsed.body;
  if (Object.hasOwn(fields, "title")) {
    const checked = checkTitle(fields.title);
    problems.push(...checked.problems);
    title = checked.title;
  }
  if (Object.hasOwn(fields, "body")) {
    problems.push(...checkBody(fields.body));
    body = typeof fields.body === "string" ? fields.body : body;
  }
  const set = names.filter((name) => !ITEM_FIELDS.has(name));
  const data = { ...parsed.data };
  for (const key of set) {
    const value = fields[key];
    if (value === null || value === undefined) delete data[key];
    else setOwn(data, key, value);
  }
  const values = checkProperties(structure, data, set, read.links, problems, item.problems);

  const keyEdits = setKeyEdits(
    parsed,
    set.map((key) => [key, Object.hasOwn(values, key) ? yamlValue(values[key]) : null]),
  );
  const titleChange = title === parsed.title ? undefined : titleEdit(parsed, title ?? "");
  const bodyChange = body === parsed.body ? undefined : bodyEdit(parsed, body ?? "");
  const text =
    keyEdits === undefined || (title !== parsed.title && titleChange === undefined) || (body !== parsed.body && bodyChange === undefined)
      ? undefined
      : checkedText(parsed, [...keyEdits, ...(titleChange ? [titleChange] : []), ...(bodyChange ? [bodyChange] : [])], { data: values, title, body });
  if (text === undefined) {
    throw invalid(
      `${names.join(", ")}: can't be changed without touching more of ${handle} than the fields named (an anchor or alias, or a value YAML can't edit in place); change it by hand in ${item.path}.`,
      [{ message: `${names.join(", ")}: can't be changed without touching more of ${handle} than the fields named (an anchor or alias, or a value YAML can't edit in place); ask the user to change it by hand` }],
    );
  }
  return { read, item, structure, text, names };
};

const checkDelete = async (root: string, handle: string, baseVersion: string) => writableItem(root, await readRoot(root), handle, baseVersion, "deleted");

export const openWriter = ({ root, store, log }: WriterOptions): Writer => ({
  createItem: (structureId, item) =>
    queueWrite(root, async () => {
      const { read, structure, title, textFor } = await checkCreate(root, structureId, item);
      const { settings } = structure;
      const id = randomUUIDv7();
      const handle = formatHandle(settings.prefix, store.nextHandleNumber(settings.id, read.floors.get(settings.prefix) ?? 0));
      const text = textFor(id, handle);
      if (text === undefined) throw new Error(`The new item ${handle} passed its read-back check with stand-in values but not with the real ones.`);
      const file = settings.naming === "free" ? (item.file ?? "") : [handle, slugOf(title)].filter(Boolean).join("-") + ".md";
      const path = joinRootPath(structure.path, file);
      try {
        await writeAtomic(join(root, path), text, { create: true });
      } catch (error) {
        if (error instanceof NoHardLinks) throw new ItemWriteError(ItemWriteErrorCode.enum.items_not_writable, error.message);
        if (!isAlreadyThere(error)) throw error;
        // The problem names the file as the structure sees it: the root-relative path would show the folders above.
        throw invalid(`${path} was created by someone else meanwhile; nothing was written, so try again${settings.naming === "free" ? " with another file" : ""}.`, [
          { field: "file", message: `file: ${file} was created by someone else meanwhile; try again${settings.naming === "free" ? " with another file" : ""}` },
        ]);
      }
      log?.("item_created", { structure: settings.id, handle });
      return loadedItem(structure, path, text, read.links);
    }),

  updateItem: (handle, fields, baseVersion) =>
    queueWrite(root, async () => {
      const { read, item, structure, text, names } = await checkUpdate(root, handle, fields, baseVersion);
      await staleIfChanged(handle, "updated", () => writeAtomic(join(root, item.path), text, { expectedVersion: baseVersion }));
      log?.("item_updated", { structure: structure.id, handle, fields: names.length });
      return loadedItem(structure, item.path, text, read.links);
    }),

  deleteItem: (handle, baseVersion) =>
    queueWrite(root, async () => {
      const { item, structure } = await checkDelete(root, handle, baseVersion);
      await staleIfChanged(handle, "deleted", () => removeUnchanged(join(root, item.path), baseVersion));
      log?.("item_deleted", { structure: structure.id, handle });
    }),

  checkNewFile: async (structureId, file, unseen = []) => {
    const read = await readRoot(root);
    const structure = writableStructureById(read, structureId);
    return checkFreeFile(root, structure, file, read.snapshot.structures, unseen);
  },

  check: (change) =>
    queueWrite(root, async () => {
      switch (change.kind) {
        case "create":
          await checkCreate(root, change.structureId, change.item, change.unseen);
          return;
        case "update":
          await checkUpdate(root, change.handle, change.fields, change.baseVersion);
          return;
        case "delete":
          await checkDelete(root, change.handle, change.baseVersion);
          return;
      }
    }),
});
