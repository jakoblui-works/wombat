// What an agent sees of the items and what its direct writes do. Reads
// show only the binders an agent may see (`agent-view.ts`), with link values as handles, never ids. A write runs
// its change kind's guards (`guards.ts`) and then the writer; a proposal runs the same guards in
// `proposals/item-proposals.ts` and is stored instead.
import type { Problem } from "@wombat/shared/items";

import { agentWriteError, itemFor, linkNotFound, scrubbed, binderFor, viewOf, type View } from "./agent-view.ts";
import { findByRef, type Catalog, type LoadedItem, type Snapshot, type ValidBinder } from "./catalog.ts";
import { writeGuards } from "./guards.ts";
import { newItem, type ItemInput } from "./refusals.ts";
import { ownValue, propertyOf, setOwn } from "./validate.ts";
import type { Writer } from "./write.ts";

/** A binder as an agent sees it: never hidden; a link property to a hidden binder has `to: null`. */
export type AgentBinder = {
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
  binders(): Promise<AgentBinder[]>;
  describe(binderId: string): Promise<AgentBinder>;
  list(binderId: string): Promise<AgentItemSummary[]>;
  get(handle: string): Promise<AgentItem>;
  search(query: string, binderId?: string): Promise<{ items: AgentItemSummary[]; truncated: boolean }>;
  create(agentId: string, binderId: string, input: ItemInput): Promise<WriteResult>;
  update(agentId: string, handle: string, fields: Record<string, unknown>, version: string): Promise<WriteResult>;
  remove(agentId: string, handle: string, version: string): Promise<WriteResult>;
};

export type AccessOptions = { catalog: Catalog; writer: Writer };

/** At most this many search hits; `truncated` says there were more. */
export const SEARCH_LIMIT = 50;

// Agent shapes.

const agentBinder = (view: View, binder: ValidBinder): AgentBinder => ({
  id: binder.id,
  name: binder.settings.name,
  access: binder.settings.access as AgentBinder["access"],
  properties: Object.fromEntries(
    Object.entries(binder.settings.properties).map(([name, property]) => [
      name,
      property.type === "link" ? { ...property, to: view.binders.has(property.to) ? property.to : null } : { ...property },
    ]),
  ),
  locked: [...binder.settings.locked],
});

/** A link value as the target's handle; null when it's missing or hidden. */
const linkHandle = (view: View, to: string, value: unknown) => {
  if (typeof value !== "string" || !view.binders.has(to)) return null;
  const inTarget = view.items.filter((item) => item.binder === to);
  return findByRef(inTarget, value)?.handle ?? null;
};

/**
 * The item's problems as an agent sees them. A link property to a hidden binder shows no link problem (the
 * agent can link nothing there); on a link to a visible binder, a value naming a hidden item and one naming
 * nothing give the same single problem, which never repeats the value.
 */
const agentProblems = (view: View, item: LoadedItem, binder: ValidBinder): Problem[] => {
  const problems: Problem[] = [];
  const linksDone = new Set<string>();
  for (const problem of item.problems) {
    const { field } = problem;
    const property = field === undefined ? undefined : propertyOf(binder.settings, field);
    if (field !== undefined && property?.type === "link") {
      if (!view.binders.has(property.to)) continue;
      if (typeof ownValue(item.properties, field) === "string") {
        if (!linksDone.has(field)) {
          linksDone.add(field);
          problems.push(linkNotFound(field, property.to));
        }
        continue;
      }
    }
    // An item without a handle is named as "the item": its path would show the folders above it.
    problems.push(...scrubbed(view, [problem], item.handle ?? "the item", binder));
  }
  return problems;
};

/** Only the binder's declared properties: an undeclared key's value (an id, a hidden name) never reaches an agent. */
const agentSummary = (view: View, item: LoadedItem): AgentItemSummary => {
  const binder = view.binders.get(item.binder) as ValidBinder;
  const properties: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(binder.settings.properties)) {
    if (!Object.hasOwn(item.properties, name)) continue;
    const value = item.properties[name];
    setOwn(properties, name, property.type === "link" ? linkHandle(view, property.to, value) : value);
  }
  return { handle: item.handle, title: item.title, properties, problems: agentProblems(view, item, binder) };
};

const agentItem = (view: View, item: LoadedItem): AgentItem => ({
  ...agentSummary(view, item),
  aliases: [...item.aliases],
  body: item.body,
  version: item.version,
});

/** A visible item as the agent view shows it, with its binder and body, for renderers beside the tools. */
export type AgentViewItem = AgentItemSummary & { binder: string; body: string | null };

/**
 * One read as an agent may see it, for what renders it outside the tools (the instructions file): the visible
 * binders with valid settings, and their items with link values as handles (null when missing or hidden).
 */
export const agentView = (snapshot: Snapshot): { binders: ValidBinder[]; items: AgentViewItem[] } => {
  const view = viewOf(snapshot);
  return {
    binders: [...view.binders.values()],
    items: view.items.map((item) => ({ ...agentSummary(view, item), binder: item.binder, body: item.body })),
  };
};

/** Whether a visible item matches a search: a case-insensitive substring of its title, body or a text property. */
const matches = (binder: ValidBinder, item: LoadedItem, query: string) => {
  const texts = [item.title, item.body];
  for (const [name, property] of Object.entries(binder.settings.properties)) {
    const value = ownValue(item.properties, name);
    if (property.type === "text") texts.push(typeof value === "string" ? value : null);
  }
  return texts.some((text) => text?.toLowerCase().includes(query));
};

export const openAccess = ({ catalog, writer }: AccessOptions): Access => {
  const view = async () => viewOf(await catalog.snapshot());
  const guards = writeGuards(writer);

  return {
    binders: async () => {
      const current = await view();
      return [...current.binders.values()].map((binder) => agentBinder(current, binder));
    },

    describe: async (binderId) => {
      const current = await view();
      return agentBinder(current, binderFor(current, binderId));
    },

    list: async (binderId) => {
      const current = await view();
      binderFor(current, binderId);
      return current.items.filter((item) => item.binder === binderId).map((item) => agentSummary(current, item));
    },

    get: async (handle) => {
      const current = await view();
      return agentItem(current, itemFor(current, handle).item);
    },

    search: async (query, binderId) => {
      const current = await view();
      if (binderId !== undefined) binderFor(current, binderId);
      const needle = query.toLowerCase();
      const hits = current.items.filter(
        (item) =>
          (binderId === undefined || item.binder === binderId) &&
          matches(current.binders.get(item.binder) as ValidBinder, item, needle),
      );
      return { items: hits.slice(0, SEARCH_LIMIT).map((item) => agentSummary(current, item)), truncated: hits.length > SEARCH_LIMIT };
    },

    create: async (_agentId, binderId, input) => {
      const current = await view();
      const binder = binderFor(current, binderId);
      const linked = await guards.create(current, binder, input, "edit");
      try {
        const created = await writer.createItem(binderId, newItem(input, linked));
        return { written: created.handle ?? "", version: created.version };
      } catch (error) {
        throw agentWriteError(current, error, { binder });
      }
    },

    update: async (_agentId, handle, fields, version) => {
      const current = await view();
      const { binder, handle: target } = itemFor(current, handle);
      const linked = guards.update(current, binder, fields, "edit");
      try {
        const updated = await writer.updateItem(target, linked, version);
        return { written: updated.handle ?? target, version: updated.version };
      } catch (error) {
        throw agentWriteError(current, error, { handle, binder });
      }
    },

    remove: async (_agentId, handle, version) => {
      const current = await view();
      const { item, binder, handle: target } = itemFor(current, handle);
      guards.remove(current, binder, item, target, "edit");
      try {
        await writer.deleteItem(target, version);
        return { deleted: target };
      } catch (error) {
        throw agentWriteError(current, error, { handle, binder });
      }
    },
  };
};
