// One read of the items as an agent may see it, and everything that turns what the catalog or writer says into what
// an agent is told: nothing names a hidden structure or item, not even in a problem or a refusal, so a hidden handle
// or structure answers exactly like a missing one.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";

import { findByHandle, isClash, linkOfField, unknownTargetMessage, type LoadedItem, type NamedProblem, type Snapshot, type ValidStructure } from "./catalog.ts";
import { invalidFields, noItem, noStructure, nothingChanged, stale } from "./refusals.ts";
import { SETTINGS_FILE } from "./structures.ts";
import { propertyOf } from "./validate.ts";
import { ItemWriteError, listed, StructureProblemsError } from "./write.ts";

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

export const viewOf = (snapshot: Snapshot): View => {
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
export const linkNotFound = (field: string, to: string): Problem => ({
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
export const scrubbed = (view: View, problems: NamedProblem[], where: string, structure: ValidStructure): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForItem(view, problem, where, structure) : plain(problem)));

const scrubbedSettings = (view: View, problems: NamedProblem[], structure: ValidStructure): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForStructure(view, problem.field, structure) : plain(problem)));

/** A visible structure, or not_found. */
export const structureFor = (view: View, id: string) => {
  const structure = view.structures.get(id);
  if (structure === undefined) throw noStructure(id);
  return structure;
};

/** A visible item and its structure, or not_found. */
export const itemFor = (view: View, handle: string) => {
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
export const linksToIds = (view: View, structure: ValidStructure, values: Record<string, unknown>) => {
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
export const checkStructure = (view: View, structure: ValidStructure) => {
  if (structure.problems.length > 0) throw structureRefusal(view, structure, structure.problems);
};

/** A writer refusal as the agent gets it: never naming anything hidden, saying what to do next. */
export const agentWriteError = (view: View, error: unknown, subject: { handle?: string; structure: ValidStructure }) => {
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
