// What an agent sees of the items and what its direct writes do. Reads
// show only the structures an agent may see (`agent-view.ts`), with link values as handles, never ids. A write runs
// its change kind's guards (`guards.ts`) and then the writer; a proposal runs the same guards in
// `proposals/item-proposals.ts` and is stored instead.
import type { Problem } from "@wombat/shared/items";

import { agentWriteError, itemFor, linkNotFound, scrubbed, structureFor, viewOf, type View } from "./agent-view.ts";
import { findByHandle, type Catalog, type LoadedItem, type Snapshot, type ValidStructure } from "./catalog.ts";
import { writeGuards } from "./guards.ts";
import { newItem, type ItemInput } from "./refusals.ts";
import { ownValue, propertyOf, setOwn } from "./validate.ts";
import type { Writer } from "./write.ts";

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
export type Access = {
  structures(): Promise<AgentStructure[]>;
  describe(structureId: string): Promise<AgentStructure>;
  list(structureId: string): Promise<AgentItemSummary[]>;
  get(handle: string): Promise<AgentItem>;
  search(query: string, structureId?: string): Promise<{ items: AgentItemSummary[]; truncated: boolean }>;
  create(agentId: string, structureId: string, input: ItemInput): Promise<WriteResult>;
  update(agentId: string, handle: string, fields: Record<string, unknown>, version: string): Promise<WriteResult>;
  remove(agentId: string, handle: string, version: string): Promise<WriteResult>;
};

export type AccessOptions = { catalog: Catalog; writer: Writer };

/** At most this many search hits; `truncated` says there were more. */
export const SEARCH_LIMIT = 50;

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

export const openAccess = ({ catalog, writer }: AccessOptions): Access => {
  const view = async () => viewOf(await catalog.snapshot());
  const guards = writeGuards(writer);

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
      const linked = await guards.create(current, structure, input, "edit");
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
      const linked = guards.update(current, structure, fields, "edit");
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
      guards.remove(current, structure, item, target, "edit");
      try {
        await writer.deleteItem(target, version);
        return { deleted: target };
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
    },
  };
};
