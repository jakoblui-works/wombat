// The items under one root, read from disk on every call: the binders (`_binder.yaml`) and their item
// files, each validated, invalid ones listed with their problems instead of dropped. Reading also writes, once
// per file: a file without an id gets one (and a handle), and a handle typed into a link field becomes the
// target's id, since links store ids, which survive renames and handle changes. Only those keys change; nothing
// in a binder with problems, in a file without a valid title, or outside every binder is ever written.
import { randomUUIDv7 } from "node:crypto";
import { join } from "node:path";

import { errorCode } from "@wombat/shared/errno";
import type { Item, Problem, BinderSettings } from "@wombat/shared/items";

import type { Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { queueWrite, readAtVersion, readVersioned, VersionChanged, writeAtomic } from "./files.ts";
import { addKeyEdits, checkedText, parseItemFile, scalarRange, type ParsedItemFile, type TextEdit } from "./item-file.ts";
import { folderProblem, inFolder, isCatalogFile, oldSettingsProblem, ownerOf, readSettings, SETTINGS_FILE, binderFiles, binderFolders } from "./binders.ts";
import { formatHandle, isUuid, parseHandle, validateOwnKeys, validateProperties, type LinkLookup } from "./validate.ts";

export type { Problem } from "@wombat/shared/items";

/**
 * A problem as the service holds it: the shared Problem, plus `names`, the ids of the binders and of the items
 * (ids, never handles) its message names besides the file or binder it's a problem of. A root-relative path
 * shows every folder above it, so a problem that shows one names every binder whose folder contains it
 * (`bindersContaining`), its own binder included. Every problem that names another binder or item, or
 * shows a root-relative path, must fill `names`: it's all access.ts reads to keep a hidden binder's names from
 * agents, so a problem without them reaches agents word for word (hidden-never-reaches-agent.test.ts guards it).
 * `names` stays inside the service: agents get problems through access.ts's filter, and the HTTP routes parse
 * theirs with the shared schemas, both of which drop it.
 */
export type NamedProblem = Problem & {
  names?: ProblemNames;
  /** Set on a handle or alias other files also have (`isClash`); stays inside the service like `names`. */
  clash?: true;
  /** Set on a leftover `_structure.yaml` beside a `_binder.yaml`: shown, but it blocks no write (`blockingProblems`); stays inside the service like `names`. */
  leftover?: true;
};
export type ProblemNames = { binders?: string[]; items?: string[] };

/**
 * A `_binder.yaml` as loaded. `id` and `settings` are null when the file fails to parse or validate, or the
 * folder holds only a `_structure.yaml`; then its files aren't loaded. A binder with settings can still have
 * problems across files (a duplicate id or prefix, a link to an unknown binder): its items are listed, but
 * none of its files are written.
 */
export type LoadedBinder =
  | { id: string; settings: BinderSettings; /** The folder, relative to the root with `/`; "" for the root. */ path: string; problems: NamedProblem[] }
  | { id: null; settings: null; path: string; problems: NamedProblem[] };

/** An item file as read: the API's `Item` with link values as the target's raw id, and its binder's id. */
export type LoadedItem = Omit<Item, "problems"> & { problems: NamedProblem[]; binder: string };

/** Everything under the root from one read. */
export type Snapshot = { binders: LoadedBinder[]; items: LoadedItem[] };

/** The item a handle names: by handle first, then by alias; with clashing handles, the first in `items` (by path in a snapshot). */
export const findByHandle = (items: readonly LoadedItem[], handle: string): LoadedItem | undefined =>
  items.find((item) => item.handle === handle) ?? items.find((item) => item.aliases.includes(handle));

export type Catalog = {
  /** The items root, as given. */
  root: string;
  /** The binders and their items, invalid ones included, from one read. */
  snapshot(): Promise<Snapshot>;
  /** Whether a file at `path` (absolute, symlinks resolved) is or would be one of the catalog's: `isCatalogFile`. */
  holds(path: string): Promise<boolean>;
};

export type CatalogOptions = { root: string; store: Store; log?: Log };

export type ValidBinder = Extract<LoadedBinder, { id: string }>;

/** A file as read, before its item is loaded: what checking it against the other files needs. */
type FileRead = {
  binder: ValidBinder;
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
  problems: NamedProblem[];
};

/** A read file with what writing it on first sight needs. */
type Entry = {
  item: LoadedItem;
  binder: ValidBinder;
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

const problemMessage = (binder: { path: string }) => (binder.path === "" ? "the root" : `${binder.path}/`);

/**
 * What showing the root-relative `path` (a file's or a folder's) names: the ids of the binder that owns it and
 * of every binder whose folder lies on its way. The root's folder shows in no path, so a binder at the root
 * is named only when it owns the path.
 */
const bindersContaining = (binders: readonly LoadedBinder[], path: string): string[] => {
  const holding = binders.filter((binder): binder is ValidBinder => binder.id !== null && inFolder(binder.path, path));
  const nearest = Math.max(...holding.map((binder) => binder.path.length));
  return [...new Set(holding.filter((binder) => binder.path !== "" || binder.path.length === nearest).map((binder) => binder.id))];
};

/** How a binder link to a missing binder reads, listing the binders there are (`ids`); access.ts lists the visible ones. */
export const unknownTargetMessage = (to: string, ids: Iterable<string>) => `to: no binder has the id "${to}"; name one of ${[...ids].sort().join(", ")}`;

/** The field of a binder problem about link property `name`'s `to`. */
export const linkToField = (name: string) => `properties.${name}.to`;

/** The link property a binder problem's field is about (see `linkToField`); undefined for any other field. */
export const linkOfField = (field: string | undefined) => /^properties\.(.+)\.to$/.exec(field ?? "")?.[1];

/**
 * Whether the problem is a handle or alias other files also have: which file a caller means can't be told. A
 * malformed handle or alias of the item's own is no clash.
 */
export const isClash = (problem: NamedProblem) => problem.clash === true;

/** The binder's problems that keep its items from being written and its read from counting as whole. */
export const blockingProblems = (binder: LoadedBinder) => binder.problems.filter((problem) => problem.leftover !== true);

/** Cross-file binder problems: ids and prefixes unique under the root, links `to` a binder that exists. */
const checkBinders = (binders: LoadedBinder[]) => {
  const valid = binders.filter((binder): binder is ValidBinder => binder.id !== null);
  const ids = new Set(valid.map((binder) => binder.id));
  for (const binder of valid) {
    for (const other of valid) {
      if (other === binder) continue;
      if (other.id === binder.id) {
        binder.problems.push({
          field: "id",
          message: `id: "${binder.id}" is also the id of the binder in ${problemMessage(other)}; give each binder its own id`,
          names: { binders: bindersContaining(binders, other.path) },
        });
      }
      if (other.settings.prefix === binder.settings.prefix) {
        binder.problems.push({
          field: "prefix",
          message: `prefix: ${binder.settings.prefix} is also the prefix of the binder in ${problemMessage(other)}; give each binder its own prefix`,
          names: { binders: bindersContaining(binders, other.path) },
        });
      }
    }
    for (const [name, property] of Object.entries(binder.settings.properties)) {
      if (property.type === "link" && !ids.has(property.to)) {
        binder.problems.push({
          field: linkToField(name),
          message: unknownTargetMessage(property.to, ids),
          names: { binders: [...ids] },
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

/** What naming other files' items names: their ids (those that have one) and every binder holding their paths. */
const namesOfFiles = (binders: readonly LoadedBinder[], reads: readonly Pick<FileRead, "path" | "names">[]): ProblemNames => ({
  binders: [...new Set(reads.flatMap((read) => bindersContaining(binders, read.path)))],
  items: [...new Set(reads.flatMap((read) => (read.names.id === null ? [] : [read.names.id])))],
});

/**
 * A file that parses, as an item of `binder`, with the link values its properties give as a handle, to rewrite
 * to the target's id. Its problems are its own keys', then `parsed.problems`, then its properties': the catalog's
 * set. Problems of the file's bytes and clashes with other files are the caller's; it adds them to
 * `parsed.problems`, so they read before the properties'. Without `links` the properties aren't read: a file the
 * service can't write back gets no property checks, as no link in it can be rewritten.
 */
export const loadItem = (
  binder: ValidBinder,
  path: string,
  parsed: ParsedItemFile,
  version: string,
  links: LinkLookup | undefined,
): { item: LoadedItem; rewrites: Map<string, string> } => {
  const validated = links === undefined ? undefined : validateProperties(binder.settings, parsed.data, links);
  return {
    item: {
      ...namesOf(parsed.data),
      title: parsed.title,
      body: parsed.body,
      properties: validated?.properties ?? {},
      path,
      version,
      problems: [...validateOwnKeys(binder.settings, parsed.data), ...parsed.problems, ...(validated?.problems ?? [])],
      binder: binder.id,
    },
    rewrites: validated?.rewrites ?? new Map<string, string>(),
  };
};

/** An item whose file can't be read or parsed: only where it is, and why. */
const emptyItem = (binder: ValidBinder, path: string, version: string, problems: Problem[]): LoadedItem => ({
  id: null,
  handle: null,
  aliases: [],
  title: null,
  body: null,
  properties: {},
  path,
  version,
  problems,
  binder: binder.id,
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
  const { folders, unreadable } = await binderFolders(root);
  const folderSet = new Set(folders.map((folder) => folder.path));
  const binders: LoadedBinder[] = await Promise.all(
    folders.map(async ({ path, settings, oldSettings }): Promise<LoadedBinder> => {
      if (!settings) return { id: null, settings: null, path, problems: [oldSettingsProblem(false)] };
      const leftover: NamedProblem[] = oldSettings ? [{ ...oldSettingsProblem(true), leftover: true }] : [];
      const result = await readSettings(join(root, path, SETTINGS_FILE));
      return result.settings === null
        ? { id: null, settings: null, path, problems: [...result.problems, ...leftover] }
        : { id: result.settings.id, settings: result.settings, path, problems: leftover };
    }),
  );
  checkBinders(binders);
  // An unreadable folder hides the files (or nested binders) under it: a problem of the binder it's in.
  for (const { folder, error } of unreadable) {
    const owner = ownerOf(folderSet, `${folder}/${SETTINGS_FILE}`);
    binders.find((binder) => binder.path === owner)?.problems.push({ ...folderProblem(folder, error), names: { binders: bindersContaining(binders, folder) } });
  }

  const reads: FileRead[] = [];
  const unnamed: ItemNames = { id: null, handle: null, aliases: [] };
  for (const binder of binders) {
    if (binder.id === null) continue;
    const { files, problems } = await binderFiles(root, binder.path, binder.settings, folderSet);
    // Their problems show the binder's own folder, and with it every folder above.
    binder.problems.push(...problems.map((problem) => ({ ...problem, names: { binders: bindersContaining(binders, binder.path) } })));
    for (const path of files) {
      const file = join(root, path);
      const unread = { binder, path, file, parsed: undefined, writable: false, names: unnamed };
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
      reads.push({ binder, path, file, version: read.version, parsed, writable, names: namesOf(parsed.data), problems });
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
      const others = same.filter((other) => other !== read);
      read.problems.push({
        field: "id",
        message: `id: ${id} is also the id of ${others.map((other) => other.path).join(", ")}; ids are unique, so remove the id line from the copy to give it a new one`,
        names: namesOfFiles(binders, others),
      });
    }
  }
  for (const [name, named] of byName) {
    if (named.length < 2) continue;
    for (const { read, as } of named) {
      const others = named.filter((other) => other.read !== read);
      const listed = others.map((other) => `the ${other.as === "handle" ? "handle" : "alias"} of ${other.read.path}`);
      const what = as === "handle" ? "handle" : "aliases";
      read.problems.push({
        field: what,
        message: `${what}: ${name} is also ${listed.join(", ")}; handles and aliases are unique, so change or remove one by hand`,
        names: namesOfFiles(binders, others.map((other) => other.read)),
        clash: true,
      });
    }
  }

  const links: LinkLookup = (to, value) => {
    const targets = byId.get(value);
    if (targets?.some((target) => target.binder.id === to)) return { kind: "id" };
    const named = byName.get(value);
    if (named === undefined) {
      if (targets === undefined) return { kind: "none", reason: "is no item's handle" };
      return { kind: "none", reason: `is the id of an item outside ${to}`, names: namesOfFiles(binders, targets) };
    }
    const reads = named.map((other) => other.read);
    if (reads.length > 1) return { kind: "none", reason: "names more than one item", names: namesOfFiles(binders, reads) };
    const [read] = reads;
    if (read?.binder.id !== to) {
      return { kind: "none", reason: `is an item of ${read?.binder.id ?? "no binder"}, not ${to}`, names: namesOfFiles(binders, read === undefined ? [] : [read]) };
    }
    // Rewriting to an id that isn't unique, or isn't an id, would turn a findable handle into a wrong link.
    const { id } = read.names;
    if (!isUuid(id) || byId.get(id)?.length !== 1) return { kind: "none", reason: "has no valid id yet", names: namesOfFiles(binders, [read]) };
    return { kind: "handle", id };
  };

  const entries: Entry[] = [];
  const assignments: Assignment[] = [];
  for (const read of reads) {
    const { binder, path, file, version, parsed } = read;
    if (parsed === undefined) {
      entries.push({ item: emptyItem(binder, path, version, read.problems), binder, file, parsed: undefined });
      continue;
    }
    const withProblems = { ...parsed, problems: [...parsed.problems, ...read.problems] };
    const { item, rewrites } = loadItem(binder, path, withProblems, version, read.writable ? links : undefined);
    const entry: Entry = { item, binder, file, parsed: read.writable ? parsed : undefined };
    entries.push(entry);
    if (!read.writable) continue;
    const needsId = parsed.data.id === undefined;
    const needsHandle = parsed.data.handle === undefined;
    if (blockingProblems(binder).length > 0) {
      if (needsId || needsHandle) {
        item.problems.push({ field: needsId ? "id" : "handle", message: `${needsId ? "id" : "handle"}: none yet; it's assigned once the binder's problems are fixed` });
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
  return { snapshot: { binders, items: sorted }, assignments, floors, links };
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
  const { settings } = entry.binder;
  const field = fieldOf(assignment);
  return queueWrite(root, async (): Promise<Outcome> => {
    // A file changed since it was read throws VersionChanged: stale, below.
    await readAtVersion(entry.file, entry.item.version);
    const keys = (id: string, handle: string) => ({ ...(needsId ? { id } : {}), ...(needsHandle ? { handle } : {}) });
    if (checkedEdit(entry.parsed, keys(randomUUIDv7(), formatHandle(settings.prefix, 1)), rewrites) === undefined) {
      return {
        kind: "failed",
        problem: { field, message: `${field}: can't be written without changing the rest of the frontmatter; write it as key: value lines from column 0` },
      };
    }
    const id = randomUUIDv7();
    const handle = needsHandle ? formatHandle(settings.prefix, store.nextHandleNumber(settings.id, floors.get(settings.prefix) ?? 0)) : "";
    const text = checkedEdit(entry.parsed, keys(id, handle), rewrites);
    if (text === undefined) throw new Error(`The first-sight edit of ${entry.item.path} passed its check with stand-in values but not with the real ones.`);
    await writeAtomic(entry.file, text, { expectedVersion: entry.item.version });
    log?.("item_first_sight", { binder: settings.id, handle: needsHandle ? handle : (entry.item.handle ?? ""), linksRewritten: rewrites.size });
    return { kind: "written" };
  }).catch((error: unknown): Outcome => {
    if (error instanceof VersionChanged) return { kind: "stale" };
    const code = errorCode(error);
    log?.("item_first_sight_failed", { binder: settings.id, item: entry.item.handle ?? entry.item.id ?? "", error: code });
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
  return { root, snapshot, holds: (path) => isCatalogFile(root, path) };
};
