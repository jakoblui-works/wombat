// The items under one root, read from disk on every call: the structures (`_structure.yaml`) and their item
// files, each validated, invalid ones listed with their problems instead of dropped. Reading also writes, once
// per file: a file without an id gets one (and a handle), and a handle typed into a link field becomes the
// target's id, since links store ids, which survive renames and handle changes. Only those keys change; nothing
// in a structure with problems, in a file without a valid title, or outside every structure is ever written.
import { randomUUIDv7 } from "node:crypto";
import { join } from "node:path";

import type { Item, Problem, StructureSettings } from "@wombat/shared/items";

import type { Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { errorCode } from "./errno.ts";
import { queueWrite, readVersioned, VersionChanged, writeAtomic } from "./files.ts";
import { addKeyEdits, checkedText, parseItemFile, scalarRange, type ParsedItemFile, type TextEdit } from "./item-file.ts";
import { folderProblem, ownerOf, readSettings, SETTINGS_FILE, structureFiles, structureFolders } from "./structures.ts";
import { isUuid, parseHandle, validateOwnKeys, validateProperties, type LinkLookup } from "./validate.ts";

export type { Problem } from "@wombat/shared/items";

/**
 * A `_structure.yaml` as loaded. `id` and `settings` are null when the file fails to parse or validate; then its
 * files aren't loaded. A structure with settings can still have problems across files (a duplicate id or prefix,
 * a link to an unknown structure): its items are listed, but none of its files are written.
 */
export type LoadedStructure =
  | { id: string; settings: StructureSettings; /** The folder, relative to the root with `/`; "" for the root. */ path: string; problems: Problem[] }
  | { id: null; settings: null; path: string; problems: Problem[] };

/** An item file as read: the API's `Item` with link values as the target's raw id, and its structure's id. */
export type LoadedItem = Item & { structure: string };

/** Everything under the root from one read. */
export type Snapshot = { structures: LoadedStructure[]; items: LoadedItem[] };

/** The item a handle names: by handle first, then by alias; with clashing handles, the first in `items` (by path in a snapshot). */
export const findByHandle = (items: readonly LoadedItem[], handle: string): LoadedItem | undefined =>
  items.find((item) => item.handle === handle) ?? items.find((item) => item.aliases.includes(handle));

export type Catalog = {
  /** The structures and their items, invalid ones included, from one read. */
  snapshot(): Promise<Snapshot>;
};

export type CatalogOptions = { root: string; store: Store; log?: Log };

export type ValidStructure = Extract<LoadedStructure, { id: string }>;

/** A file as read, before its item is loaded: what checking it against the other files needs. */
type FileRead = {
  structure: ValidStructure;
  /** Relative to the root, with `/`. */
  path: string;
  /** Absolute path. */
  file: string;
  /** "" when the file can't be read. */
  version: string;
  /** Undefined when the file can't be read or parsed; then `problems` says why. */
  parsed: ParsedItemFile | undefined;
  /** Whether writing the text back keeps the file's bytes: it's valid UTF-8. */
  writable: boolean;
  names: ItemNames;
  /** The file's problems besides its own keys', title's and properties': its bytes', and clashes with other files. */
  problems: Problem[];
};

/** A read file with what writing it on first sight needs. */
type Entry = {
  item: LoadedItem;
  structure: ValidStructure;
  /** Absolute path. */
  file: string;
  parsed: ParsedItemFile | undefined;
};

/** What a first-sight write adds or changes in one file. */
type Assignment = {
  entry: Entry & { parsed: ParsedItemFile };
  needsId: boolean;
  needsHandle: boolean;
  /** Link property → the target id replacing the handle typed there. */
  rewrites: Map<string, string>;
};

const problemMessage = (structure: { path: string }) => (structure.path === "" ? "the root" : `${structure.path}/`);

/** Cross-file structure problems: ids and prefixes unique under the root, links `to` a structure that exists. */
const checkStructures = (structures: LoadedStructure[]) => {
  const valid = structures.filter((structure): structure is ValidStructure => structure.id !== null);
  const ids = new Set(valid.map((structure) => structure.id));
  for (const structure of valid) {
    for (const other of valid) {
      if (other === structure) continue;
      if (other.id === structure.id) {
        structure.problems.push({
          field: "id",
          message: `id: "${structure.id}" is also the id of the structure in ${problemMessage(other)}; give each structure its own id`,
        });
      }
      if (other.settings.prefix === structure.settings.prefix) {
        structure.problems.push({
          field: "prefix",
          message: `prefix: ${structure.settings.prefix} is also the prefix of the structure in ${problemMessage(other)}; give each structure its own prefix`,
        });
      }
    }
    for (const [name, property] of Object.entries(structure.settings.properties)) {
      if (property.type === "link" && !ids.has(property.to)) {
        structure.problems.push({
          field: `properties.${name}.to`,
          message: `to: no structure has the id "${property.to}"; name one of ${[...ids].sort().join(", ")}`,
        });
      }
    }
  }
};

type ItemNames = Pick<LoadedItem, "id" | "handle" | "aliases">;

/** The names a file's frontmatter gives its item; a value that isn't text names nothing. */
const namesOf = ({ id, handle, aliases }: Record<string, unknown>): ItemNames => ({
  id: typeof id === "string" ? id : null,
  handle: typeof handle === "string" ? handle : null,
  aliases: Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : [],
});

/**
 * A file that parses, as an item of `structure`, with the link values its properties give as a handle, to rewrite
 * to the target's id. Its problems are its own keys', then `parsed.problems`, then its properties': the catalog's
 * set. Problems of the file's bytes and clashes with other files are the caller's; it adds them to
 * `parsed.problems`, so they read before the properties'. Without `links` the properties aren't read: a file the
 * service can't write back gets no property checks, as no link in it can be rewritten.
 */
export const loadItem = (
  structure: ValidStructure,
  path: string,
  parsed: ParsedItemFile,
  version: string,
  links: LinkLookup | undefined,
): { item: LoadedItem; rewrites: Map<string, string> } => {
  const validated = links === undefined ? undefined : validateProperties(structure.settings, parsed.data, links);
  return {
    item: {
      ...namesOf(parsed.data),
      title: parsed.title,
      body: parsed.body,
      properties: validated?.properties ?? {},
      path,
      version,
      problems: [...validateOwnKeys(structure.settings, parsed.data), ...parsed.problems, ...(validated?.problems ?? [])],
      structure: structure.id,
    },
    rewrites: validated?.rewrites ?? new Map<string, string>(),
  };
};

/** An item whose file can't be read or parsed: only where it is, and why. */
const emptyItem = (structure: ValidStructure, path: string, version: string, problems: Problem[]): LoadedItem => ({
  id: null,
  handle: null,
  aliases: [],
  title: null,
  body: null,
  properties: {},
  path,
  version,
  problems,
  structure: structure.id,
});

/** One full read of the root: what it holds, and what writing to it needs. */
export type RootRead = {
  snapshot: Snapshot;
  /** The first-sight writes the read calls for. */
  assignments: Assignment[];
  /** Handle prefix → the highest number a handle or alias on disk has. */
  floors: Map<string, number>;
  /** What a link value names, across every item read. */
  links: LinkLookup;
};

/** Reads the whole root without writing anything; writers call it inside the root's write queue. */
export const readRoot = async (root: string): Promise<RootRead> => {
  const { folders, unreadable } = await structureFolders(root);
  const folderSet = new Set(folders);
  const structures: LoadedStructure[] = await Promise.all(
    folders.map(async (path): Promise<LoadedStructure> => {
      const result = await readSettings(join(root, path, SETTINGS_FILE));
      return result.settings === null
        ? { id: null, settings: null, path, problems: result.problems }
        : { id: result.settings.id, settings: result.settings, path, problems: [] };
    }),
  );
  checkStructures(structures);
  // An unreadable folder hides the files (or nested structures) under it: a problem of the structure it's in.
  for (const { folder, error } of unreadable) {
    const owner = ownerOf(folderSet, `${folder}/${SETTINGS_FILE}`);
    structures.find((structure) => structure.path === owner)?.problems.push(folderProblem(folder, error));
  }

  const reads: FileRead[] = [];
  const unnamed: ItemNames = { id: null, handle: null, aliases: [] };
  for (const structure of structures) {
    if (structure.id === null) continue;
    const { files, problems } = await structureFiles(root, structure.path, structure.settings, folderSet);
    structure.problems.push(...problems);
    for (const path of files) {
      const file = join(root, path);
      const unread = { structure, path, file, parsed: undefined, writable: false, names: unnamed };
      let read;
      try {
        read = await readVersioned(file);
      } catch (error) {
        const code = errorCode(error);
        reads.push({ ...unread, version: "", problems: [{ message: `file: can't be read (${code}); check its permissions` }] });
        continue;
      }
      if (read === undefined) continue;
      const parsed = parseItemFile(read.text);
      if (!parsed.ok) {
        reads.push({ ...unread, version: read.version, problems: parsed.problems });
        continue;
      }
      // Text that isn't valid UTF-8 wouldn't survive a write byte for byte.
      const writable = Buffer.from(read.text, "utf8").equals(read.bytes);
      const problems: Problem[] = writable ? [] : [{ message: "file: not valid UTF-8; save it as UTF-8" }];
      reads.push({ structure, path, file, version: read.version, parsed, writable, names: namesOf(parsed.data), problems });
    }
  }

  // Ids, handles and aliases across the root.
  const byId = new Map<string, FileRead[]>();
  const byName = new Map<string, { read: FileRead; as: "handle" | "aliases" }[]>();
  const floors = new Map<string, number>();
  const noteNumber = (name: string) => {
    const parsed = parseHandle(name);
    if (parsed !== undefined) floors.set(parsed.prefix, Math.max(floors.get(parsed.prefix) ?? 0, parsed.number));
  };
  for (const read of reads) {
    const { id, handle, aliases } = read.names;
    if (id !== null) byId.set(id, [...(byId.get(id) ?? []), read]);
    for (const [name, as] of [...(handle === null ? [] : [[handle, "handle"] as const]), ...aliases.map((alias) => [alias, "aliases"] as const)]) {
      noteNumber(name);
      const named = byName.get(name) ?? [];
      if (!named.some((other) => other.read === read)) byName.set(name, [...named, { read, as }]);
    }
  }
  for (const [id, same] of byId) {
    if (same.length < 2) continue;
    for (const read of same) {
      const others = same.filter((other) => other !== read).map((other) => other.path);
      read.problems.push({ field: "id", message: `id: ${id} is also the id of ${others.join(", ")}; ids are unique, so remove the id line from the copy to give it a new one` });
    }
  }
  for (const [name, named] of byName) {
    if (named.length < 2) continue;
    for (const { read, as } of named) {
      const others = named.filter((other) => other.read !== read).map((other) => `the ${other.as === "handle" ? "handle" : "alias"} of ${other.read.path}`);
      const what = as === "handle" ? "handle" : "aliases";
      read.problems.push({ field: what, message: `${what}: ${name} is also ${others.join(", ")}; handles and aliases are unique, so change or remove one by hand` });
    }
  }

  const links: LinkLookup = (to, value) => {
    const targets = byId.get(value);
    if (targets?.some((target) => target.structure.id === to)) return { kind: "id" };
    const named = byName.get(value);
    if (named === undefined) return { kind: "none", reason: targets === undefined ? "is no item's handle" : `is the id of an item outside ${to}` };
    if (named.length > 1) return { kind: "none", reason: "names more than one item" };
    const [{ read } = { read: undefined }] = named;
    if (read?.structure.id !== to) return { kind: "none", reason: `is an item of ${read?.structure.id ?? "no structure"}, not ${to}` };
    // Rewriting to an id that isn't unique, or isn't an id, would turn a findable handle into a wrong link.
    const { id } = read.names;
    if (!isUuid(id) || byId.get(id)?.length !== 1) return { kind: "none", reason: "has no valid id yet" };
    return { kind: "handle", id };
  };

  const entries: Entry[] = [];
  const assignments: Assignment[] = [];
  for (const read of reads) {
    const { structure, path, file, version, parsed } = read;
    if (parsed === undefined) {
      entries.push({ item: emptyItem(structure, path, version, read.problems), structure, file, parsed: undefined });
      continue;
    }
    const withProblems = { ...parsed, problems: [...parsed.problems, ...read.problems] };
    const { item, rewrites } = loadItem(structure, path, withProblems, version, read.writable ? links : undefined);
    const entry: Entry = { item, structure, file, parsed: read.writable ? parsed : undefined };
    entries.push(entry);
    if (!read.writable) continue;
    const needsId = parsed.data.id === undefined;
    const needsHandle = parsed.data.handle === undefined;
    if (structure.problems.length > 0) {
      if (needsId || needsHandle) {
        item.problems.push({ field: needsId ? "id" : "handle", message: `${needsId ? "id" : "handle"}: none yet; it's assigned once the structure's problems are fixed` });
      }
      continue;
    }
    // Without a valid title the file's shape is in doubt (a stray fence, text before the heading): never written.
    if (parsed.problems.length > 0) continue;
    if (needsId || needsHandle || rewrites.size > 0) {
      assignments.push({ entry: { ...entry, parsed }, needsId, needsHandle, rewrites });
    }
  }

  const sorted = entries.map((entry) => entry.item).sort((a, b) => a.path.localeCompare(b.path));
  return { snapshot: { structures, items: sorted }, assignments, floors, links };
};

/** How a first-sight write ended: `stale` when the file changed since it was read (the next pass retries). */
type Outcome = { kind: "written" } | { kind: "stale" } | { kind: "failed"; problem: Problem };

/** The field a first-sight write is about, for its problem. */
const fieldOf = ({ needsId, needsHandle, rewrites }: Assignment) => (needsId ? "id" : needsHandle ? "handle" : ([...rewrites.keys()][0] ?? "id"));

/** The file after the edits, or undefined when the edits would change more than the keys they add or rewrite. */
const checkedEdit = (parsed: ParsedItemFile, added: { id?: string; handle?: string }, rewrites: Map<string, string>) => {
  const edits: TextEdit[] = addKeyEdits(parsed, added);
  for (const [name, target] of rewrites) {
    const range = scalarRange(parsed, name);
    if (range === undefined) return undefined;
    edits.push({ ...range, text: target });
  }
  return checkedText(parsed, edits, { data: { ...parsed.data, ...added, ...Object.fromEntries(rewrites) }, title: parsed.title, body: parsed.body });
};

/**
 * Writes one file's first-sight keys through the root's queue, unless the file changed since it was read. The
 * edit is checked with stand-in values before the handle number is taken, so a skipped or refused write takes
 * no number.
 */
const assign = (root: string, store: Store, log: Log | undefined, floors: Map<string, number>, assignment: Assignment): Promise<Outcome> => {
  const { entry, needsId, needsHandle, rewrites } = assignment;
  const { settings } = entry.structure;
  const field = fieldOf(assignment);
  return queueWrite(root, async (): Promise<Outcome> => {
    const current = await readVersioned(entry.file);
    if (current?.version !== entry.item.version) return { kind: "stale" };
    const keys = (id: string, handle: string) => ({ ...(needsId ? { id } : {}), ...(needsHandle ? { handle } : {}) });
    if (checkedEdit(entry.parsed, keys(randomUUIDv7(), `${settings.prefix}-1`), rewrites) === undefined) {
      return {
        kind: "failed",
        problem: { field, message: `${field}: can't be written without changing the rest of the frontmatter; write it as key: value lines from column 0` },
      };
    }
    const id = randomUUIDv7();
    const handle = needsHandle ? `${settings.prefix}-${store.nextHandleNumber(settings.id, floors.get(settings.prefix) ?? 0)}` : "";
    const text = checkedEdit(entry.parsed, keys(id, handle), rewrites);
    if (text === undefined) throw new Error(`The first-sight edit of ${entry.item.path} passed its check with stand-in values but not with the real ones.`);
    await writeAtomic(entry.file, text, { expectedVersion: entry.item.version });
    log?.("item_first_sight", { structure: settings.id, handle: needsHandle ? handle : (entry.item.handle ?? ""), linksRewritten: rewrites.size });
    return { kind: "written" };
  }).catch((error: unknown): Outcome => {
    if (error instanceof VersionChanged) return { kind: "stale" };
    const code = errorCode(error);
    log?.("item_first_sight_failed", { structure: settings.id, item: entry.item.handle ?? entry.item.id ?? "", error: code });
    return {
      kind: "failed",
      problem: { field, message: `${field}: couldn't be written (${code}); make the file and its folder writable, and the next read writes it` },
    };
  });
};

/** Enough for one pass of writes and one to read back what a parallel read wrote; then the read stands. */
const MAX_PASSES = 3;

export const openCatalog = ({ root, store, log }: CatalogOptions): Catalog => {
  const snapshot = async () => {
    /** Root-relative path → why its write failed; not retried within this read. */
    const failed = new Map<string, Problem>();
    for (let pass = 1; ; pass += 1) {
      const { snapshot: read, assignments, floors } = await readRoot(root);
      for (const item of read.items) {
        const problem = failed.get(item.path);
        if (problem !== undefined) item.problems.push(problem);
      }
      const pending = assignments.filter((assignment) => !failed.has(assignment.entry.item.path));
      if (pending.length === 0) return read;
      if (pass === MAX_PASSES) {
        for (const { entry, needsId } of pending) {
          if (needsId) entry.item.problems.push({ field: "id", message: "id: none yet; the file kept changing while it was read, and gets one on the next read" });
        }
        return read;
      }
      const outcomes = await Promise.all(pending.map((assignment) => assign(root, store, log, floors, assignment)));
      outcomes.forEach((outcome, index) => {
        const path = pending[index]?.entry.item.path;
        if (outcome.kind === "failed" && path !== undefined) failed.set(path, outcome.problem);
      });
    }
  };
  return { snapshot };
};
