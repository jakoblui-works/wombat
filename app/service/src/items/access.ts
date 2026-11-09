// What an agent sees of the items and what its writes do: the one place access levels are enforced. Reads show
// only the structures an agent may see, with link values as handles (never ids) and nothing that names a hidden
// structure or item, not even in a problem or a refusal: a hidden handle or structure answers exactly like a
// missing one. Writes are routed by the structure's level (`edit`: written through the writer; `propose`: stored
// as a proposal for the user to approve; `read`: refused), and a change touching a locked field is refused by name
// before anything is written or stored. Approving applies a proposal through the writer on the version the agent
// read, under the structure's settings as they are now; anything changed since makes it a conflict, never an
// overwrite.
import type { Problem, Proposal, ProposalStatus } from "@wombat/shared/items";

import { logToStderr, type Log } from "../agents/manager.ts";
import type { Store, StoredProposal } from "../store/store.ts";
import type { Catalog, LoadedItem, Snapshot, ValidStructure } from "./catalog.ts";
import { SETTINGS_FILE } from "./structures.ts";
import { OWN_KEYS, validateProperties, type LinkLookup } from "./validate.ts";
import { addedProblems, checkBody, checkTitle, isValueProblem, ItemWriteError, type Writer } from "./write.ts";

export type AccessErrorCode = "not_found" | "read_only" | "use_propose" | "use_edit" | "locked" | "stale_version" | "invalid_fields";

/** Why an agent's call was refused; the message says what to do next. */
export class AccessError extends Error {
  readonly code: AccessErrorCode;
  readonly problems: Problem[];

  constructor(code: AccessErrorCode, message: string, problems: Problem[] = []) {
    super(message);
    this.name = "AccessError";
    this.code = code;
    this.problems = problems;
  }
}

export type ProposalErrorCode = "proposal_not_found" | "proposal_not_pending";

/** Why deciding a proposal was refused; nothing changed. */
export class ProposalError extends Error {
  readonly code: ProposalErrorCode;

  constructor(code: ProposalErrorCode, message: string) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
  }
}

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

export type ItemInput = { title: string; body?: string; properties?: Record<string, unknown>; file?: string };
export type WriteResult = { written: string; version: string } | { deleted: string };
export type ProposalResult = { proposed: string };

export type Access = {
  structures(): Promise<AgentStructure[]>;
  describe(structureId: string): Promise<AgentStructure>;
  list(structureId: string): Promise<AgentItemSummary[]>;
  get(handle: string): Promise<AgentItem>;
  search(query: string, structureId?: string): Promise<{ items: AgentItemSummary[]; truncated: boolean }>;
  create(agentId: string, structureId: string, input: ItemInput): Promise<WriteResult>;
  update(agentId: string, handle: string, fields: Record<string, unknown>, version: string): Promise<WriteResult>;
  remove(agentId: string, handle: string, version: string): Promise<WriteResult>;
  proposeCreate(agentId: string, structureId: string, input: ItemInput, reason: string): Promise<ProposalResult>;
  proposeUpdate(agentId: string, handle: string, fields: Record<string, unknown>, version: string, reason: string): Promise<ProposalResult>;
  proposeDelete(agentId: string, handle: string, version: string, reason: string): Promise<ProposalResult>;
  /** For people (HTTP): every proposal, hidden structures' included, or those with `status`. */
  proposals(status?: ProposalStatus): Promise<Proposal[]>;
  /** Applies a pending proposal through the writer; a conflict answers with `status: "conflict"` and its problem. */
  approve(id: string): Promise<Proposal>;
  /** Marks a pending proposal rejected; no file is touched. */
  reject(id: string): Promise<Proposal>;
};

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

/** The tool of each family for each change. */
const TOOLS = {
  create: { edit: "create_item", propose: "propose_create" },
  update: { edit: "update_item", propose: "propose_update" },
  delete: { edit: "delete_item", propose: "propose_delete" },
} as const;
type Change = keyof typeof TOOLS;
type Family = "edit" | "propose";

/** A create's fields that aren't properties. */
const ITEM_FIELDS = new Set(["title", "body"]);

/** One read of the root as an agent may see it. */
type View = {
  snapshot: Snapshot;
  /** Visible structures by id; a structure id any hidden structure has is never visible. */
  structures: Map<string, ValidStructure>;
  /** The items of visible structures. */
  items: LoadedItem[];
  /** Everything naming a hidden structure or item (lowercased): ids, names, folders, paths, handles. */
  hidden: string[];
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
  const hidden = new Set<string>();
  const hiddenStructures = valid.filter((candidate) => hiddenIds.has(candidate.id));
  for (const structure of hiddenStructures) {
    hidden.add(structure.id);
    hidden.add(structure.settings.name);
    if (structure.path !== "") hidden.add(`${structure.path}/`);
  }
  for (const item of snapshot.items.filter((candidate) => hiddenIds.has(candidate.structure))) {
    for (const name of [item.path, item.id, item.handle, ...item.aliases]) if (name !== null) hidden.add(name);
  }
  return {
    snapshot,
    structures,
    items: snapshot.items.filter((item) => structures.has(item.structure)),
    hidden: [...hidden].filter((name) => name !== "").map((name) => name.toLowerCase()),
    hiddenFolders: hiddenStructures.map((structure) => structure.path),
  };
};

const mentionsHidden = (view: View, text: string) => {
  const lower = text.toLowerCase();
  return view.hidden.some((name) => lower.includes(name));
};

const listed = (problems: Problem[]) => problems.map((problem) => problem.message).join("; ");

/** Fields whose problems can name another file or structure: an item's own keys, and a link's target. */
const NAMING_FIELDS = new Set(["id", "handle", "aliases"]);

/**
 * Problems with any that can name another file (a field-less one, an id, handle or alias clash, a link) and names
 * something hidden replaced by one that doesn't. With `structure`, the item's link properties count; without it
 * (a structure's own problems), every problem does. An ordinary value problem reads as the catalog gives it.
 */
const scrubbed = (view: View, problems: Problem[], where: string, structure?: ValidStructure): Problem[] =>
  problems.map((problem) => {
    const { field } = problem;
    const canName =
      structure === undefined ||
      field === undefined ||
      NAMING_FIELDS.has(field) ||
      (!ITEM_FIELDS.has(field) && !Object.hasOwn(structure.settings.properties, field)) ||
      structure.settings.properties[field]?.type === "link";
    if (!canName || !mentionsHidden(view, problem.message)) return problem;
    return {
      ...(field === undefined ? {} : { field }),
      message: `${field ?? "file"}: clashes with another file; ask the user to fix ${where} by hand`,
    };
  });

// Refusals. The not_found texts name only what the agent typed, so a hidden name reads exactly like a missing one.

const noItem = (handle: string) =>
  new AccessError("not_found", `No item has the handle ${handle}. Check it, or find the item with search or list_items.`);

const noStructure = (id: string) =>
  new AccessError("not_found", `No structure has the id ${id}. Call describe_structure without a structure to see the ones you can use.`);

const stale = (handle: string) =>
  new AccessError("stale_version", `${handle} changed since you read it (by hand or by another write). Re-read it with get_item and try again.`);

const invalidFields = (message: string, problems: Problem[] = []) => new AccessError("invalid_fields", message, problems);

/** A visible structure, or not_found. */
const structureFor = (view: View, id: string) => {
  const structure = view.structures.get(id);
  if (structure === undefined) throw noStructure(id);
  return structure;
};

/** A visible item by handle, then by alias. */
const findItem = (items: LoadedItem[], handle: string) =>
  items.find((item) => item.handle === handle) ?? items.find((item) => item.aliases.includes(handle));

/** A visible item and its structure, or not_found. */
const itemFor = (view: View, handle: string) => {
  const item = findItem(view.items, handle);
  const structure = item === undefined ? undefined : view.structures.get(item.structure);
  if (item?.handle == null || structure === undefined) throw noItem(handle);
  return { item, structure, handle: item.handle };
};

/** Refuses a change of the wrong family, or any change in a read structure, naming what to use instead. */
const checkLevel = (structure: ValidStructure, family: Family, change: Change) => {
  const { access } = structure.settings;
  if (access === "read") {
    throw new AccessError("read_only", `${structure.id} is read-only for agents: its items can be read, never changed. Ask the user if it needs this change.`);
  }
  if (access === family) return;
  if (access === "propose") {
    throw new AccessError(
      "use_propose",
      `${structure.id} takes proposals, not direct changes: use ${TOOLS[change].propose} with a reason, and the user approves or rejects it.`,
    );
  }
  throw new AccessError("use_edit", `${structure.id} is open to direct changes, so there's nothing to propose: use ${TOOLS[change].edit} instead.`);
};

/** Refuses a change touching a locked field, naming it. */
const checkLocks = (structure: ValidStructure, names: string[]) => {
  const locked = names.filter((name) => structure.settings.locked.includes(name));
  if (locked.length === 0) return;
  const one = locked.length === 1;
  throw new AccessError(
    "locked",
    `${locked.join(", ")} ${one ? "is" : "are"} locked in ${structure.id}: agents can't change ${one ? "it" : "them"}. Leave ${one ? "it" : "them"} out, or ask the user to make the change.`,
  );
};

/** Refuses the service's own keys (id, handle, aliases) in a change. */
const checkOwnKeys = (names: string[]) => {
  const own = names.filter((name) => OWN_KEYS.has(name));
  if (own.length > 0) {
    throw invalidFields(`${own.join(", ")}: the service sets ${own.length === 1 ? "this field" : "these fields"}; leave ${own.length === 1 ? "it" : "them"} out.`);
  }
};

/** Link values given as handles turned into the targets' ids; a hidden or missing handle is not_found. */
const linksToIds = (view: View, structure: ValidStructure, values: Record<string, unknown>) => {
  const converted = { ...values };
  for (const [name, value] of Object.entries(values)) {
    const property = structure.settings.properties[name];
    if (property?.type !== "link" || typeof value !== "string") continue;
    if (!view.structures.has(property.to)) throw noItem(value);
    const target = findItem(view.items, value);
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

/** Link lookups for checking a proposal: link values are ids by now, of any item in the target structure. */
const idLookup = (view: View): LinkLookup => (to, value) =>
  view.snapshot.items.some((item) => item.structure === to && item.id === value) ? { kind: "id" } : { kind: "none", reason: "is no item's handle" };

const withoutEmpty = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null));

/** Refuses an item an update can't touch (D15): problems other than property values. */
const checkUpdatable = (view: View, item: LoadedItem, structure: ValidStructure, handle: string) => {
  const blocking = item.problems.filter((problem) => !isValueProblem(structure.settings, problem));
  if (blocking.length === 0 && item.id !== null) return;
  const problems = scrubbed(view, blocking, handle, structure);
  throw invalidFields(`${handle} has problems only the user can fix by hand (${listed(problems) || "no id yet"}), so it can't be changed. Ask the user to fix it.`, problems);
};

/** Refuses an item a delete can't touch (D15): a handle another file also has, or no id to name it by. */
const checkDeletable = (view: View, item: LoadedItem, structure: ValidStructure, handle: string) => {
  const blocking = item.problems.filter((problem) => problem.field === "handle" || problem.field === "aliases");
  if (blocking.length > 0) {
    const problems = scrubbed(view, blocking, handle, structure);
    throw invalidFields(`${handle} shares its handle with another file (${listed(problems)}), so it can't be deleted. Ask the user to fix it by hand.`, problems);
  }
  if (item.id === null) {
    const problems = [{ field: "id", message: "id: none yet; the service gives one once the file's problems are fixed" }];
    throw invalidFields(`${handle} has no id yet, so it can't be deleted. Ask the user to fix ${handle} by hand.`, problems);
  }
};

/** The structure's problems, which refuse every write. */
const checkStructure = (view: View, structure: ValidStructure) => {
  if (structure.problems.length === 0) return;
  const problems = scrubbed(view, structure.problems, `${structure.id}'s ${SETTINGS_FILE}`);
  throw invalidFields(`${structure.id} has problems in its settings (${listed(problems)}), so its items can't be changed. Ask the user to fix its ${SETTINGS_FILE}.`, problems);
};

/** A writer refusal as the agent gets it: never naming anything hidden, saying what to do next. */
const agentWriteError = (view: View, error: unknown, subject: { handle?: string; structure: ValidStructure }) => {
  if (!(error instanceof ItemWriteError)) return error;
  switch (error.code) {
    case "stale_version":
      return stale(subject.handle ?? "The item");
    case "item_not_found":
      return noItem(subject.handle ?? "");
    case "structure_not_found":
      return noStructure(subject.structure.id);
    case "field_not_writable":
    case "invalid_fields": {
      const problems = scrubbed(view, error.problems, subject.handle ?? "the item", subject.structure);
      const message = mentionsHidden(view, error.message)
        ? `Nothing was written: ${listed(problems) || "the change doesn't fit the structure"}. Fix what's named and try again.`
        : error.message;
      return invalidFields(message, problems);
    }
    case "items_not_writable":
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
  return (inTarget.find((item) => item.id === value) ?? findItem(inTarget, value))?.handle ?? null;
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
    const property = field === undefined ? undefined : structure.settings.properties[field];
    if (field !== undefined && property?.type === "link") {
      if (!view.structures.has(property.to)) continue;
      if (typeof item.properties[field] === "string") {
        if (!linksDone.has(field)) {
          linksDone.add(field);
          problems.push({ field, message: `${field}: the linked item can't be found; link an item of ${property.to} by its handle, or clear the field` });
        }
        continue;
      }
    }
    problems.push(...scrubbed(view, [problem], item.handle ?? item.path, structure));
  }
  return problems;
};

const agentSummary = (view: View, item: LoadedItem): AgentItemSummary => {
  const structure = view.structures.get(item.structure) as ValidStructure;
  const properties: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(item.properties)) {
    const property = structure.settings.properties[name];
    properties[name] = property?.type === "link" ? linkHandle(view, property.to, value) : value;
  }
  return { handle: item.handle, title: item.title, properties, problems: agentProblems(view, item, structure) };
};

const agentItem = (view: View, item: LoadedItem): AgentItem => ({
  ...agentSummary(view, item),
  aliases: [...item.aliases],
  body: item.body,
  version: item.version,
});

/** Whether a visible item matches a search: a case-insensitive substring of its title, body or a text property. */
const matches = (structure: ValidStructure, item: LoadedItem, query: string) => {
  const texts = [item.title, item.body];
  for (const [name, property] of Object.entries(structure.settings.properties)) {
    if (property.type === "text") texts.push(typeof item.properties[name] === "string" ? item.properties[name] : null);
  }
  return texts.some((text) => text?.toLowerCase().includes(query));
};

export const openAccess = ({ catalog, writer, store, onProposal, log = logToStderr }: AccessOptions): Access => {
  const view = async () => viewOf(await catalog.snapshot());

  /** Announces a committed proposal change; a failing listener never makes the committed change look failed. */
  const announce = (id: string, seq: number) => {
    try {
      onProposal(id, seq);
    } catch (error) {
      log("proposal_alert_failed", { proposalId: id, seq, error: error instanceof Error ? error.name : "unknown" });
    }
  };

  /** Stores a proposal and announces it once committed. */
  const propose = (proposal: Parameters<Store["insertProposal"]>[0]): ProposalResult => {
    const { proposal: stored, seq } = store.insertProposal(proposal);
    announce(stored.id, seq);
    return { proposed: stored.id };
  };

  /**
   * The problems of a free-named structure's new `file` (D20), checked before anything is written or stored; a
   * path in a hidden structure's folder reads exactly like one in a folder that doesn't exist.
   */
  const fileProblems = async (current: View, structure: ValidStructure, file: unknown) => {
    if (structure.settings.naming !== "free") return [];
    try {
      return await writer.checkNewFile(structure.id, file, current.hiddenFolders);
    } catch (error) {
      throw agentWriteError(current, error, { structure });
    }
  };

  /** A stored proposal with its item's current handle (people see hidden structures too). */
  const proposalOf = (stored: StoredProposal, items: LoadedItem[], handle?: string | null): Proposal => {
    const { itemId, ...rest } = stored;
    const found = itemId === null ? undefined : items.find((item) => item.id === itemId);
    return { ...rest, handle: handle !== undefined ? handle : (found?.handle ?? null) };
  };

  /** Approvals and rejections one at a time, so a proposal is never applied twice. */
  let deciding: Promise<unknown> = Promise.resolve();
  const decide = <T>(job: () => Promise<T>): Promise<T> => {
    const result = deciding.then(job);
    deciding = result.catch(() => undefined);
    return result;
  };

  const pending = (id: string) => {
    const stored = store.getProposal(id);
    if (stored === undefined) throw new ProposalError("proposal_not_found", `No proposal has the id ${id}. Refresh the proposals to see the current ones.`);
    if (stored.status !== "pending") {
      throw new ProposalError(
        "proposal_not_pending",
        `Proposal ${id} is already ${stored.status}; only a pending proposal can be approved or rejected. Refresh the proposals to see its state.`,
      );
    }
    return stored;
  };

  /** Records the decision and announces it once committed. */
  const finish = (id: string, items: LoadedItem[], status: Exclude<ProposalStatus, "pending">, problem?: Problem, created?: LoadedItem) => {
    const change = store.setProposalStatus(id, status, problem, created?.id ?? undefined);
    // Only a decision racing another (they're serialized here) finds it no longer pending.
    if (change === undefined) {
      pending(id);
      throw new Error(`Proposal ${id} is pending but couldn't be decided; try again.`);
    }
    announce(id, change.seq);
    return proposalOf(change.proposal, items, created?.handle);
  };

  /** Applies a pending proposal, or says why it can't be: what changed since the agent read the item. */
  const apply = async (stored: StoredProposal, snapshot: Snapshot): Promise<{ problem: Problem } | { created?: LoadedItem }> => {
    const conflict = (message: string, field?: string) => ({ problem: { ...(field === undefined ? {} : { field }), message } });
    const structures = snapshot.structures.filter((structure): structure is ValidStructure => structure.id === stored.structure);
    const [structure] = structures;
    if (structure === undefined) {
      return conflict(`The structure ${stored.structure} is gone, or its ${SETTINGS_FILE} is broken, so nothing was applied. Fix its settings and ask the agent again, or reject the proposal.`);
    }
    const access = structures.some((candidate) => candidate.settings.access === "hidden") ? "hidden" : structure.settings.access;
    if (access === "hidden" || access === "read") {
      return conflict(`${stored.structure} is now ${access}, so agents' changes no longer apply to it and nothing was applied. Make the change by hand if you still want it.`, "access");
    }
    const names = Object.keys(stored.fields).filter((name) => stored.kind !== "create" || !ITEM_FIELDS.has(name));
    const locked = names.filter((name) => structure.settings.locked.includes(name));
    if (locked.length > 0) {
      return conflict(`${locked.join(", ")} became locked in ${stored.structure}, so nothing was applied. Make the change by hand if you still want it.`, locked[0]);
    }

    try {
      if (stored.kind === "create") {
        const { title, body, file, ...properties } = stored.fields;
        const freeFile = structure.settings.naming === "free" && !Object.hasOwn(structure.settings.properties, "file");
        if (!freeFile && file !== undefined) properties.file = file;
        const created = await writer.createItem(structure.id, {
          title: title as string,
          body: typeof body === "string" ? body : "",
          properties,
          ...(freeFile && typeof file === "string" ? { file } : {}),
        });
        return { created };
      }
      const item = stored.itemId === null ? undefined : snapshot.items.find((candidate) => candidate.id === stored.itemId);
      if (item?.handle == null) return conflict("The item was deleted, or its id changed by hand, since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again.");
      if (item.structure !== stored.structure) return conflict(`The item moved to ${item.structure} since the agent read it, so nothing was applied. Reject the proposal, or ask the agent again.`);
      const baseVersion = stored.baseVersion ?? "";
      if (stored.kind === "update") await writer.updateItem(item.handle, stored.fields, baseVersion);
      else await writer.deleteItem(item.handle, baseVersion);
      return {};
    } catch (error) {
      if (!(error instanceof ItemWriteError) || error.code === "items_not_writable") throw error;
      if (error.code === "stale_version" || error.code === "item_not_found") {
        return conflict(`The item changed (edited, renamed or deleted) since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again and propose anew.`);
      }
      const [only] = error.problems;
      return conflict(error.message, error.problems.length === 1 ? only?.field : undefined);
    }
  };

  return {
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
      checkLocks(structure, Object.keys(properties));
      const linked = linksToIds(current, structure, properties);
      const badFile = await fileProblems(current, structure, input.file);
      if (badFile.length > 0) {
        throw invalidFields(`The new item's file doesn't fit ${structure.id}: ${listed(badFile)}. Nothing was written; give another path and try again.`, badFile);
      }
      try {
        const created = await writer.createItem(structureId, {
          title: input.title,
          body: input.body ?? "",
          properties: linked,
          ...(input.file === undefined ? {} : { file: input.file }),
        });
        return { written: created.handle ?? "", version: created.version };
      } catch (error) {
        throw agentWriteError(current, error, { structure });
      }
    },

    update: async (_agentId, handle, fields, version) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "edit", "update");
      checkLocks(structure, Object.keys(fields));
      checkStructure(current, structure);
      checkUpdatable(current, item, structure, target);
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
      checkDeletable(current, item, structure, target);
      try {
        await writer.deleteItem(target, version);
        return { deleted: target };
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
    },

    proposeCreate: async (agentId, structureId, input, reason) => {
      const current = await view();
      const structure = structureFor(current, structureId);
      checkLevel(structure, "propose", "create");
      const properties = input.properties ?? {};
      checkLocks(structure, Object.keys(properties));
      checkOwnKeys(Object.keys(properties));
      const linked = withoutEmpty(linksToIds(current, structure, properties));
      checkStructure(current, structure);

      const { title, problems } = checkTitle(input.title);
      if (input.body !== undefined) problems.push(...checkBody(input.body));
      const { settings } = structure;
      if (settings.naming === "free") {
        problems.push(...(await fileProblems(current, structure, input.file)));
        if (Object.hasOwn(settings.properties, "file")) {
          problems.push({ field: "file", message: `file: ${structure.id} has a property named file, so a new file's path can't be proposed; ask the user to create the item` });
        }
      } else if (input.file !== undefined) {
        problems.push({ field: "file", message: `file: ${structure.id} names its files by handle, so leave file out` });
      }
      problems.push(...validateProperties(settings, linked, idLookup(current)).problems);
      if (problems.length > 0) throw invalidFields(`The new item doesn't fit ${structure.id}: ${listed(problems)}. Nothing was stored; fix it and propose again.`, problems);

      return propose({
        structure: structure.id,
        itemId: null,
        kind: "create",
        fields: { title, ...(input.body === undefined ? {} : { body: input.body }), ...linked, ...(input.file === undefined ? {} : { file: input.file }) },
        reason,
        baseVersion: null,
        agentId,
      });
    },

    proposeUpdate: async (agentId, handle, fields, version, reason) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "propose", "update");
      const names = Object.keys(fields);
      checkLocks(structure, names);
      checkOwnKeys(names);
      if (names.length === 0) throw invalidFields("The proposal names no fields; give at least one field to change.");
      checkStructure(current, structure);
      checkUpdatable(current, item, structure, target);
      if (item.version !== version) throw stale(handle);
      const linked = linksToIds(current, structure, fields);

      const problems: Problem[] = [];
      if ("title" in linked) problems.push(...checkTitle(linked.title).problems);
      if ("body" in linked) problems.push(...checkBody(linked.body));
      const set = names.filter((name) => !ITEM_FIELDS.has(name));
      const data: Record<string, unknown> = { ...item.properties };
      for (const name of set) {
        if (linked[name] === null || linked[name] === undefined) delete data[name];
        else data[name] = linked[name];
      }
      const after = validateProperties(structure.settings, data, idLookup(current)).problems;
      problems.push(...addedProblems(item.problems, after, set));
      if (problems.length > 0) {
        const shown = scrubbed(current, problems, target, structure);
        throw invalidFields(`The change doesn't fit ${structure.id}: ${listed(shown)}. Nothing was stored; fix it and propose again.`, shown);
      }

      return propose({ structure: structure.id, itemId: item.id, kind: "update", fields: linked, reason, baseVersion: version, agentId });
    },

    proposeDelete: async (agentId, handle, version, reason) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "propose", "delete");
      checkStructure(current, structure);
      checkDeletable(current, item, structure, target);
      if (item.version !== version) throw stale(handle);
      return propose({ structure: structure.id, itemId: item.id, kind: "delete", fields: {}, reason, baseVersion: version, agentId });
    },

    proposals: async (status) => {
      const { items } = await catalog.snapshot();
      return store.listProposals(status).map((stored) => proposalOf(stored, items));
    },

    approve: (id) =>
      decide(async () => {
        const stored = pending(id);
        const snapshot = await catalog.snapshot();
        const outcome = await apply(stored, snapshot);
        if ("problem" in outcome) return finish(id, snapshot.items, "conflict", outcome.problem);
        return finish(id, snapshot.items, "approved", undefined, outcome.created);
      }),

    reject: (id) =>
      decide(async () => {
        pending(id);
        const { items } = await catalog.snapshot();
        return finish(id, items, "rejected");
      }),
  };
};
