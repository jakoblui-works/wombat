// What an agent sees of the items and what its writes do: the one place access levels are enforced. Reads show
// only the structures an agent may see, with link values as handles (never ids) and nothing that names a hidden
// structure or item, not even in a problem or a refusal: a hidden handle or structure answers exactly like a
// missing one. Writes are routed by the structure's level (`edit`: written through the writer; `propose`: stored
// as a proposal for the user to approve; `read`: refused), and a change touching a locked field is refused by name
// before anything is written or stored.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";

import { logToStderr, type Log } from "../log.ts";
import { openItemProposals, type ItemProposals } from "../proposals/item-proposals.ts";
import type { Store } from "../store/store.ts";
import { findByHandle, isClash, linkOfField, unknownTargetMessage, type Catalog, type LoadedItem, type NamedProblem, type Snapshot, type ValidStructure } from "./catalog.ts";
import { checkHasId, checkLevel, checkLocks, invalidFields, newItem, noItem, noStructure, nothingChanged, stale, type Family, type ItemInput } from "./refusals.ts";
import { SETTINGS_FILE } from "./structures.ts";
import { ownValue, propertyOf, setOwn } from "./validate.ts";
import { ItemWriteError, listed, StructureProblemsError, type Writer } from "./write.ts";

/** A structure as an agent sees it: never hidden; a link property to a hidden structure has `to: null`. */
export type AgentStructure = {
  id: string;
  name: string;
  access: "read" | "propose" | "edit";
  properties: Record<string, { type: string; to?: string | null; options?: string[]; required?: boolean }>;
  locked: string[];
};

/** Handles only, never ids; a link value is the target's handle, or null when it is missing or hidden. */
export type AgentItemSummary = { handle: string | null; title: string | null; properties: Record<string, unknown>; problems: Problem[] };
export type AgentItem = AgentItemSummary & { aliases: string[]; body: string | null; version: string };

export type WriteResult = { written: string; version: string } | { deleted: string };

/** An agent's reads and direct changes. */
type AgentItems = {
  structures(): Promise<AgentStructure[]>;
  describe(structureId: string): Promise<AgentStructure>;
  list(structureId: string): Promise<AgentItemSummary[]>;
  get(handle: string): Promise<AgentItem>;
  search(query: string, structureId?: string): Promise<{ items: AgentItemSummary[]; truncated: boolean }>;
  create(agentId: string, structureId: string, input: ItemInput): Promise<WriteResult>;
  update(agentId: string, handle: string, fields: Record<string, unknown>, version: string): Promise<WriteResult>;
  remove(agentId: string, handle: string, version: string): Promise<WriteResult>;
};

export type Access = AgentItems & ItemProposals;

export type AccessOptions = {
  catalog: Catalog;
  writer: Writer;
  store: Store;
  /** Called after every proposal write (stored or decided) is committed, with the seq it took. */
  onProposal: (id: string, seq: number) => void;
  log?: Log;
};

/** At most this many search hits; `truncated` says there were more. */
export const SEARCH_LIMIT = 50;

/** One read of the root as an agent may see it. */
export type View = {
  snapshot: Snapshot;
  /** Visible structures by id; a structure id any hidden structure has is never visible. */
  structures: Map<string, ValidStructure>;
  /** The items of visible structures. */
  items: LoadedItem[];
  /** Hidden structures' ids. */
  hiddenStructures: Set<string>;
  /** The ids of hidden structures' items. */
  hiddenItems: Set<string>;
  /** Hidden structures' folders, relative to the root. */
  hiddenFolders: string[];
};

const viewOf = (snapshot: Snapshot): View => {
  const valid = snapshot.structures.filter((structure): structure is ValidStructure => structure.id !== null);
  const hiddenIds = new Set(valid.filter((structure) => structure.settings.access === "hidden").map((structure) => structure.id));
  const structures = new Map<string, ValidStructure>();
  for (const structure of valid) {
    if (!hiddenIds.has(structure.id) && !structures.has(structure.id)) structures.set(structure.id, structure);
  }
  const hiddenItems = snapshot.items.filter((item) => hiddenIds.has(item.structure)).flatMap((item) => (item.id === null ? [] : [item.id]));
  return {
    snapshot,
    structures,
    items: snapshot.items.filter((item) => structures.has(item.structure)),
    hiddenStructures: hiddenIds,
    hiddenItems: new Set(hiddenItems),
    hiddenFolders: valid.filter((structure) => hiddenIds.has(structure.id)).map((structure) => structure.path),
  };
};

/** Whether a problem names a hidden structure or an item of one; decided by its `names` alone, never its wording. */
const namesHidden = (view: View, problem: NamedProblem) =>
  (problem.names?.structures ?? []).some((id) => view.hiddenStructures.has(id)) || (problem.names?.items ?? []).some((id) => view.hiddenItems.has(id));

/** A problem with the shared Problem's keys only: the service's `names` never leave it. */
const plain = ({ field, line, message }: NamedProblem): Problem => ({ ...(field === undefined ? {} : { field }), ...(line === undefined ? {} : { line }), message });

/** A link value that names nothing an agent can link: a hidden item reads exactly like a missing one. */
const linkNotFound = (field: string, to: string): Problem => ({
  field,
  message: `${field}: the linked item can't be found; link an item of ${to} by its handle, or clear the field`,
});

/**
 * Any value of a link property whose target structure the agent can't see (describe shows its `to` as null):
 * the same whichever structure it is, so it never tells one hidden structure from another.
 */
const linkUnusable = (field: string): Problem => ({
  field,
  message: `${field}: links to no structure you can use, so it takes no value; leave it out, or ask the user to set it`,
});

/** What a structure's problem says in place of one naming something hidden, by what it is about. */
const neutralForStructure = (view: View, field: string | undefined, structure: ValidStructure): Problem => {
  const fix = `ask the user to fix ${structure.id}'s ${SETTINGS_FILE} by hand`;
  if (field === "id") return { field, message: `id: another structure has the same id; ${fix}` };
  if (field === "prefix") return { field, message: `prefix: another structure has the same prefix; ${fix}` };
  const property = propertyOf(structure.settings, linkOfField(field) ?? "");
  // The catalog's sentence with only the structures an agent sees, so it reads the same with or without hidden ones.
  if (field !== undefined && property?.type === "link") return { field, message: unknownTargetMessage(property.to, view.structures.keys()) };
  // The only field-less structure problems that name a structure: a folder of it that can't be read.
  if (field === undefined) return { message: "folder: a folder of this structure can't be read; ask the user to make it readable so its items load" };
  return { field, message: `${field}: has a problem only the user can fix; ${fix}` };
};

/** What an item's problem says in place of one naming something hidden, by what it is about. */
const neutralForItem = (view: View, problem: NamedProblem, where: string, structure: ValidStructure): Problem => {
  const { field } = problem;
  const fix = `ask the user to fix ${where} by hand`;
  if (field === "id") return { field, message: `id: another file has the same id; ${fix}` };
  if (field !== undefined && isClash(problem)) return { field, message: `${field}: another file has the same handle or alias; ${fix}` };
  if (field === "file") return { field, message: `file: a new item of ${structure.id} can't go there; pick a path in its own folder` };
  const property = field === undefined ? undefined : propertyOf(structure.settings, field);
  if (field !== undefined && property?.type === "link") return view.structures.has(property.to) ? linkNotFound(field, property.to) : linkUnusable(field);
  return { ...(field === undefined ? {} : { field }), message: `${field ?? "file"}: has a problem only the user can fix; ${fix}` };
};

/**
 * Every problem an agent gets goes through one of these two, as plain shared Problems: one whose `names` name a
 * hidden structure or an item of one is replaced by a neutral one about the same field, and every other reads as
 * the catalog or writer gave it. `scrubbed` takes the problems of an item (or a new item) of `structure`, named
 * `where` in the neutral texts; `scrubbedSettings` takes the structure's own.
 */
const scrubbed = (view: View, problems: NamedProblem[], where: string, structure: ValidStructure): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForItem(view, problem, where, structure) : plain(problem)));

const scrubbedSettings = (view: View, problems: NamedProblem[], structure: ValidStructure): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForStructure(view, problem.field, structure) : plain(problem)));

/** A visible structure, or not_found. */
const structureFor = (view: View, id: string) => {
  const structure = view.structures.get(id);
  if (structure === undefined) throw noStructure(id);
  return structure;
};

/** A visible item and its structure, or not_found. */
const itemFor = (view: View, handle: string) => {
  const item = findByHandle(view.items, handle);
  const structure = item === undefined ? undefined : view.structures.get(item.structure);
  if (item?.handle == null || structure === undefined) throw noItem(handle);
  return { item, structure, handle: item.handle };
};

/**
 * Link values given as handles turned into the targets' ids; a hidden or missing handle is not_found. A link
 * property to a structure the agent can't see takes no value at all, refused here before the writer, whose
 * problem for a value of the wrong type would name the structure.
 */
const linksToIds = (view: View, structure: ValidStructure, values: Record<string, unknown>) => {
  const converted = { ...values };
  for (const [name, value] of Object.entries(values)) {
    const property = propertyOf(structure.settings, name);
    // null or undefined sets no value (it clears the field, or leaves it out).
    if (property?.type !== "link" || value === null || value === undefined) continue;
    if (!view.structures.has(property.to)) {
      if (typeof value === "string") throw noItem(value);
      const problems = [linkUnusable(name)];
      throw invalidFields(nothingChanged(problems), problems);
    }
    if (typeof value !== "string") continue;
    const target = findByHandle(view.items, value);
    if (target === undefined) throw noItem(value);
    if (target.structure !== property.to) {
      const message = `${name}: links to items of ${property.to}, and ${value} is in ${target.structure}; link an item of ${property.to} by its handle`;
      throw invalidFields(`${message}.`, [{ field: name, message }]);
    }
    if (target.id === null) {
      const message = `${name}: ${value} has no id yet, so it can't be linked; ask the user to look at it`;
      throw invalidFields(`${message}.`, [{ field: name, message }]);
    }
    converted[name] = target.id;
  }
  return converted;
};

/** A refusal for the structure's problems, scrubbed as the structure's own. */
const structureRefusal = (view: View, structure: ValidStructure, structureProblems: NamedProblem[]) => {
  const problems = scrubbedSettings(view, structureProblems, structure);
  return invalidFields(`${structure.id} has problems in its settings (${listed(problems)}), so its items can't be changed. Ask the user to fix its ${SETTINGS_FILE}.`, problems);
};

/**
 * The structure's problems, which refuse every write. Checked here as well as by the writer because converting
 * link handles to ids needs sound settings: a broken link setting answers with the structure's problems.
 */
const checkStructure = (view: View, structure: ValidStructure) => {
  if (structure.problems.length > 0) throw structureRefusal(view, structure, structure.problems);
};

/** A writer refusal as the agent gets it: never naming anything hidden, saying what to do next. */
const agentWriteError = (view: View, error: unknown, subject: { handle?: string; structure: ValidStructure }) => {
  if (!(error instanceof ItemWriteError)) return error;
  // The structure's problems found by the writer's own read (they appeared after the view's).
  if (error instanceof StructureProblemsError) return structureRefusal(view, subject.structure, error.problems);
  switch (error.code) {
    case ItemWriteErrorCode.enum.stale_version:
      return stale(subject.handle ?? "The item");
    case ItemWriteErrorCode.enum.item_not_found:
      return noItem(subject.handle ?? "");
    case ItemWriteErrorCode.enum.structure_not_found:
      return noStructure(subject.structure.id);
    case ItemWriteErrorCode.enum.field_not_writable:
      // Names only the service's own keys the call gave; it has no problems.
      return invalidFields(error.message);
    case ItemWriteErrorCode.enum.invalid_fields: {
      // Always built from the scrubbed problems, never the writer's message: that shows root-relative paths, and
      // one format whatever was scrubbed means a scrubbed refusal can't be told apart by its shape.
      const problems = scrubbed(view, error.problems, subject.handle ?? "the item", subject.structure);
      return invalidFields(nothingChanged(problems), problems);
    }
    case ItemWriteErrorCode.enum.items_not_writable:
      return error;
  }
};

// Agent shapes.

const agentStructure = (view: View, structure: ValidStructure): AgentStructure => ({
  id: structure.id,
  name: structure.settings.name,
  access: structure.settings.access as AgentStructure["access"],
  properties: Object.fromEntries(
    Object.entries(structure.settings.properties).map(([name, property]) => [
      name,
      property.type === "link" ? { ...property, to: view.structures.has(property.to) ? property.to : null } : { ...property },
    ]),
  ),
  locked: [...structure.settings.locked],
});

/** A link value as the target's handle; null when it's missing or hidden. */
const linkHandle = (view: View, to: string, value: unknown) => {
  if (typeof value !== "string" || !view.structures.has(to)) return null;
  const inTarget = view.items.filter((item) => item.structure === to);
  return (inTarget.find((item) => item.id === value) ?? findByHandle(inTarget, value))?.handle ?? null;
};

/**
 * The item's problems as an agent sees them. A link property to a hidden structure shows no link problem (the
 * agent can link nothing there); on a link to a visible structure, a value naming a hidden item and one naming
 * nothing give the same single problem, which never repeats the value.
 */
const agentProblems = (view: View, item: LoadedItem, structure: ValidStructure): Problem[] => {
  const problems: Problem[] = [];
  const linksDone = new Set<string>();
  for (const problem of item.problems) {
    const { field } = problem;
    const property = field === undefined ? undefined : propertyOf(structure.settings, field);
    if (field !== undefined && property?.type === "link") {
      if (!view.structures.has(property.to)) continue;
      if (typeof ownValue(item.properties, field) === "string") {
        if (!linksDone.has(field)) {
          linksDone.add(field);
          problems.push(linkNotFound(field, property.to));
        }
        continue;
      }
    }
    // An item without a handle is named as "the item": its path would show the folders above it.
    problems.push(...scrubbed(view, [problem], item.handle ?? "the item", structure));
  }
  return problems;
};

/** Only the structure's declared properties: an undeclared key's value (an id, a hidden name) never reaches an agent. */
const agentSummary = (view: View, item: LoadedItem): AgentItemSummary => {
  const structure = view.structures.get(item.structure) as ValidStructure;
  const properties: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(structure.settings.properties)) {
    if (!Object.hasOwn(item.properties, name)) continue;
    const value = item.properties[name];
    setOwn(properties, name, property.type === "link" ? linkHandle(view, property.to, value) : value);
  }
  return { handle: item.handle, title: item.title, properties, problems: agentProblems(view, item, structure) };
};

const agentItem = (view: View, item: LoadedItem): AgentItem => ({
  ...agentSummary(view, item),
  aliases: [...item.aliases],
  body: item.body,
  version: item.version,
});

/** A visible item as the agent view shows it, with its structure and body, for renderers beside the tools. */
export type AgentViewItem = AgentItemSummary & { structure: string; body: string | null };

/**
 * One read as an agent may see it, for what renders it outside the tools (the instructions file): the visible
 * structures with valid settings, and their items with link values as handles (null when missing or hidden).
 */
export const agentView = (snapshot: Snapshot): { structures: ValidStructure[]; items: AgentViewItem[] } => {
  const view = viewOf(snapshot);
  return {
    structures: [...view.structures.values()],
    items: view.items.map((item) => ({ ...agentSummary(view, item), structure: item.structure, body: item.body })),
  };
};

/** Whether a visible item matches a search: a case-insensitive substring of its title, body or a text property. */
const matches = (structure: ValidStructure, item: LoadedItem, query: string) => {
  const texts = [item.title, item.body];
  for (const [name, property] of Object.entries(structure.settings.properties)) {
    const value = ownValue(item.properties, name);
    if (property.type === "text") texts.push(typeof value === "string" ? value : null);
  }
  return texts.some((text) => text?.toLowerCase().includes(query));
};

export const openAccess = ({ catalog, writer, store, onProposal, log = logToStderr }: AccessOptions): Access => {
  const view = async () => viewOf(await catalog.snapshot());

  /**
   * The problems of a free-named structure's new `file`, checked before anything is written or stored; a
   * path in a hidden structure's folder reads exactly like one in a folder that doesn't exist.
   */
  const fileProblems = async (current: View, structure: ValidStructure, file: unknown) => {
    if (structure.settings.naming !== "free") return [];
    try {
      return scrubbed(current, await writer.checkNewFile(structure.id, file, current.hiddenFolders), "the new item", structure);
    } catch (error) {
      throw agentWriteError(current, error, { structure });
    }
  };

  /** Refuses a free-named structure's new `file` that doesn't fit, saying what was left undone by `family`'s change. */
  const checkNewFile = async (current: View, structure: ValidStructure, file: unknown, family: Family) => {
    const badFile = await fileProblems(current, structure, file);
    if (badFile.length === 0) return;
    const next = family === "edit" ? "Nothing was written; give another path and try again." : "Nothing was stored; give another path and propose again.";
    throw invalidFields(`The new item's file doesn't fit ${structure.id}: ${listed(badFile)}. ${next}`, badFile);
  };

  const agent: AgentItems = {
    structures: async () => {
      const current = await view();
      return [...current.structures.values()].map((structure) => agentStructure(current, structure));
    },

    describe: async (structureId) => {
      const current = await view();
      return agentStructure(current, structureFor(current, structureId));
    },

    list: async (structureId) => {
      const current = await view();
      structureFor(current, structureId);
      return current.items.filter((item) => item.structure === structureId).map((item) => agentSummary(current, item));
    },

    get: async (handle) => {
      const current = await view();
      return agentItem(current, itemFor(current, handle).item);
    },

    search: async (query, structureId) => {
      const current = await view();
      if (structureId !== undefined) structureFor(current, structureId);
      const needle = query.toLowerCase();
      const hits = current.items.filter(
        (item) =>
          (structureId === undefined || item.structure === structureId) &&
          matches(current.structures.get(item.structure) as ValidStructure, item, needle),
      );
      return { items: hits.slice(0, SEARCH_LIMIT).map((item) => agentSummary(current, item)), truncated: hits.length > SEARCH_LIMIT };
    },

    create: async (_agentId, structureId, input) => {
      const current = await view();
      const structure = structureFor(current, structureId);
      checkLevel(structure, "edit", "create");
      const properties = input.properties ?? {};
      checkLocks(structure, "create", Object.keys(properties));
      const linked = linksToIds(current, structure, properties);
      checkStructure(current, structure);
      await checkNewFile(current, structure, input.file, "edit");
      try {
        const created = await writer.createItem(structureId, newItem(input, linked));
        return { written: created.handle ?? "", version: created.version };
      } catch (error) {
        throw agentWriteError(current, error, { structure });
      }
    },

    update: async (_agentId, handle, fields, version) => {
      const current = await view();
      const { structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "edit", "update");
      checkLocks(structure, "update", Object.keys(fields));
      checkStructure(current, structure);
      const linked = linksToIds(current, structure, fields);
      try {
        const updated = await writer.updateItem(target, linked, version);
        return { written: updated.handle ?? target, version: updated.version };
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
    },

    remove: async (_agentId, handle, version) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "edit", "delete");
      checkStructure(current, structure);
      checkHasId(item, target);
      try {
        await writer.deleteItem(target, version);
        return { deleted: target };
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
    },
  };

  return {
    ...agent,
    ...openItemProposals({ catalog, writer, store, onProposal, log, viewOf, structureFor, itemFor, checkStructure, linksToIds, checkNewFile, agentWriteError }),
  };
};
