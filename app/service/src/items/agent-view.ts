// One read of the items as an agent may see it, and everything that turns what the catalog or writer says into what
// an agent is told: nothing names a hidden binder or item, not even in a problem or a refusal, so a hidden handle
// or binder answers exactly like a missing one.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";

import { findByHandle, isClash, linkOfField, unknownTargetMessage, type LoadedItem, type NamedProblem, type Snapshot, type ValidBinder } from "./catalog.ts";
import { invalidFields, noItem, noBinder, nothingChanged, stale } from "./refusals.ts";
import { SETTINGS_FILE } from "./binders.ts";
import { propertyOf } from "./validate.ts";
import { ItemWriteError, listed, BinderProblemsError } from "./write.ts";

/** One read of the root as an agent may see it. */
export type View = {
  snapshot: Snapshot;
  /** Visible binders by id; a binder id any hidden binder has is never visible. */
  binders: Map<string, ValidBinder>;
  /** The items of visible binders. */
  items: LoadedItem[];
  /** Hidden binders' ids. */
  hiddenBinders: Set<string>;
  /** The ids of hidden binders' items. */
  hiddenItems: Set<string>;
  /** Hidden binders' folders, relative to the root. */
  hiddenFolders: string[];
};

export const viewOf = (snapshot: Snapshot): View => {
  const valid = snapshot.binders.filter((binder): binder is ValidBinder => binder.id !== null);
  const hiddenIds = new Set(valid.filter((binder) => binder.settings.access === "hidden").map((binder) => binder.id));
  const binders = new Map<string, ValidBinder>();
  for (const binder of valid) {
    if (!hiddenIds.has(binder.id) && !binders.has(binder.id)) binders.set(binder.id, binder);
  }
  const hiddenItems = snapshot.items.filter((item) => hiddenIds.has(item.binder)).flatMap((item) => (item.id === null ? [] : [item.id]));
  return {
    snapshot,
    binders,
    items: snapshot.items.filter((item) => binders.has(item.binder)),
    hiddenBinders: hiddenIds,
    hiddenItems: new Set(hiddenItems),
    hiddenFolders: valid.filter((binder) => hiddenIds.has(binder.id)).map((binder) => binder.path),
  };
};

/** Whether a problem names a hidden binder or an item of one; decided by its `names` alone, never its wording. */
const namesHidden = (view: View, problem: NamedProblem) =>
  (problem.names?.binders ?? []).some((id) => view.hiddenBinders.has(id)) || (problem.names?.items ?? []).some((id) => view.hiddenItems.has(id));

/** A problem with the shared Problem's keys only: the service's `names` never leave it. */
const plain = ({ field, line, message }: NamedProblem): Problem => ({ ...(field === undefined ? {} : { field }), ...(line === undefined ? {} : { line }), message });

/** A link value that names nothing an agent can link: a hidden item reads exactly like a missing one. */
export const linkNotFound = (field: string, to: string): Problem => ({
  field,
  message: `${field}: the linked item can't be found; link an item of ${to} by its handle, or clear the field`,
});

/**
 * Any value of a link property whose target binder the agent can't see (describe shows its `to` as null):
 * the same whichever binder it is, so it never tells one hidden binder from another.
 */
const linkUnusable = (field: string): Problem => ({
  field,
  message: `${field}: links to no binder you can use, so it takes no value; leave it out, or ask the user to set it`,
});

/** What a binder's problem says in place of one naming something hidden, by what it is about. */
const neutralForBinder = (view: View, field: string | undefined, binder: ValidBinder): Problem => {
  const fix = `ask the user to fix ${binder.id}'s ${SETTINGS_FILE} by hand`;
  if (field === "id") return { field, message: `id: another binder has the same id; ${fix}` };
  if (field === "prefix") return { field, message: `prefix: another binder has the same prefix; ${fix}` };
  const property = propertyOf(binder.settings, linkOfField(field) ?? "");
  // The catalog's sentence with only the binders an agent sees, so it reads the same with or without hidden ones.
  if (field !== undefined && property?.type === "link") return { field, message: unknownTargetMessage(property.to, view.binders.keys()) };
  // The only field-less binder problems that name a binder: a folder of it that can't be read.
  if (field === undefined) return { message: "folder: a folder of this binder can't be read; ask the user to make it readable so its items load" };
  return { field, message: `${field}: has a problem only the user can fix; ${fix}` };
};

/** What an item's problem says in place of one naming something hidden, by what it is about. */
const neutralForItem = (view: View, problem: NamedProblem, where: string, binder: ValidBinder): Problem => {
  const { field } = problem;
  const fix = `ask the user to fix ${where} by hand`;
  if (field === "id") return { field, message: `id: another file has the same id; ${fix}` };
  if (field !== undefined && isClash(problem)) return { field, message: `${field}: another file has the same handle or alias; ${fix}` };
  if (field === "file") return { field, message: `file: a new item of ${binder.id} can't go there; pick a path in its own folder` };
  const property = field === undefined ? undefined : propertyOf(binder.settings, field);
  if (field !== undefined && property?.type === "link") return view.binders.has(property.to) ? linkNotFound(field, property.to) : linkUnusable(field);
  return { ...(field === undefined ? {} : { field }), message: `${field ?? "file"}: has a problem only the user can fix; ${fix}` };
};

/**
 * Every problem an agent gets goes through one of these two, as plain shared Problems: one whose `names` name a
 * hidden binder or an item of one is replaced by a neutral one about the same field, and every other reads as
 * the catalog or writer gave it. `scrubbed` takes the problems of an item (or a new item) of `binder`, named
 * `where` in the neutral texts; `scrubbedSettings` takes the binder's own.
 */
export const scrubbed = (view: View, problems: NamedProblem[], where: string, binder: ValidBinder): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForItem(view, problem, where, binder) : plain(problem)));

const scrubbedSettings = (view: View, problems: NamedProblem[], binder: ValidBinder): Problem[] =>
  problems.map((problem) => (namesHidden(view, problem) ? neutralForBinder(view, problem.field, binder) : plain(problem)));

/** A visible binder, or not_found. */
export const binderFor = (view: View, id: string) => {
  const binder = view.binders.get(id);
  if (binder === undefined) throw noBinder(id);
  return binder;
};

/** A visible item and its binder, or not_found. */
export const itemFor = (view: View, handle: string) => {
  const item = findByHandle(view.items, handle);
  const binder = item === undefined ? undefined : view.binders.get(item.binder);
  if (item?.handle == null || binder === undefined) throw noItem(handle);
  return { item, binder, handle: item.handle };
};

/**
 * Link values given as handles turned into the targets' ids; a hidden or missing handle is not_found. A link
 * property to a binder the agent can't see takes no value at all, refused here before the writer, whose
 * problem for a value of the wrong type would name the binder.
 */
export const linksToIds = (view: View, binder: ValidBinder, values: Record<string, unknown>) => {
  const converted = { ...values };
  for (const [name, value] of Object.entries(values)) {
    const property = propertyOf(binder.settings, name);
    // null or undefined sets no value (it clears the field, or leaves it out).
    if (property?.type !== "link" || value === null || value === undefined) continue;
    if (!view.binders.has(property.to)) {
      if (typeof value === "string") throw noItem(value);
      const problems = [linkUnusable(name)];
      throw invalidFields(nothingChanged(problems), problems);
    }
    if (typeof value !== "string") continue;
    const target = findByHandle(view.items, value);
    if (target === undefined) throw noItem(value);
    if (target.binder !== property.to) {
      const message = `${name}: links to items of ${property.to}, and ${value} is in ${target.binder}; link an item of ${property.to} by its handle`;
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

/** A refusal for the binder's problems, scrubbed as the binder's own. */
const binderRefusal = (view: View, binder: ValidBinder, binderProblems: NamedProblem[]) => {
  const problems = scrubbedSettings(view, binderProblems, binder);
  return invalidFields(`${binder.id} has problems in its settings (${listed(problems)}), so its items can't be changed. Ask the user to fix its ${SETTINGS_FILE}.`, problems);
};

/**
 * The binder's problems, which refuse every write. Checked here as well as by the writer because converting
 * link handles to ids needs sound settings: a broken link setting answers with the binder's problems.
 */
export const checkBinder = (view: View, binder: ValidBinder) => {
  if (binder.problems.length > 0) throw binderRefusal(view, binder, binder.problems);
};

/** A writer refusal as the agent gets it: never naming anything hidden, saying what to do next. */
export const agentWriteError = (view: View, error: unknown, subject: { handle?: string; binder: ValidBinder }) => {
  if (!(error instanceof ItemWriteError)) return error;
  // The binder's problems found by the writer's own read (they appeared after the view's).
  if (error instanceof BinderProblemsError) return binderRefusal(view, subject.binder, error.problems);
  switch (error.code) {
    case ItemWriteErrorCode.enum.stale_version:
      return stale(subject.handle ?? "The item");
    case ItemWriteErrorCode.enum.item_not_found:
      return noItem(subject.handle ?? "");
    case ItemWriteErrorCode.enum.binder_not_found:
      return noBinder(subject.binder.id);
    case ItemWriteErrorCode.enum.field_not_writable:
      // Names only the service's own keys the call gave; it has no problems.
      return invalidFields(error.message);
    case ItemWriteErrorCode.enum.invalid_fields: {
      // Always built from the scrubbed problems, never the writer's message: that shows root-relative paths, and
      // one format whatever was scrubbed means a scrubbed refusal can't be told apart by its shape.
      const problems = scrubbed(view, error.problems, subject.handle ?? "the item", subject.binder);
      return invalidFields(nothingChanged(problems), problems);
    }
    case ItemWriteErrorCode.enum.items_not_writable:
      return error;
  }
};
