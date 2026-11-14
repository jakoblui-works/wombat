// What an item proposal targets and what its create makes, pure: the item it changes as it is now, and a create's
// fields as the new item's input and as a version stores them.
import type { LoadedItem } from "../items/catalog.ts";
import type { ItemInput } from "../items/refusals.ts";
import type { StoredProposal } from "../store/store.ts";

export type StoredItemProposal = Extract<StoredProposal, { target: "item" }>;

export const itemById = (items: readonly LoadedItem[], id: string | null | undefined) => (id == null ? undefined : items.find((item) => item.id === id));

/** The item a proposal targets among `items` now: found, with its handle; `"gone"` (no item has its id, or it has no handle); or moved to another structure. */
export type TargetItem = { item: LoadedItem; handle: string } | "gone" | { movedTo: string };

/** The item update or delete proposal `stored` targets, as it is among `items` now. */
export const targetItem = (items: readonly LoadedItem[], stored: StoredItemProposal): TargetItem => {
  const item = itemById(items, stored.itemId);
  if (item?.handle == null) return "gone";
  return item.structure === stored.structure ? { item, handle: item.handle } : { movedTo: item.structure };
};

export type CreateInput = ItemInput & { properties: Record<string, unknown> };

/**
 * A create's fields as the new item's input: its title, its body, the rest as properties, and the file the proposal
 * names. `input` keeps a body as given, so the writer's check refuses one that isn't text; `written` leaves such a
 * body out, for approve's write.
 */
export const createInputOf = (fields: Record<string, unknown>, file: string | null): { input: CreateInput; written: CreateInput } => {
  const { title, body, ...properties } = fields;
  // The writer checks the title's and body's types.
  const made = { title: title as string, properties, ...(file === null ? {} : { file }) };
  return {
    input: { ...made, ...(body === undefined ? {} : { body: body as string }) },
    written: { ...made, ...(typeof body === "string" ? { body } : {}) },
  };
};

/** A create's fields as a version stores them: its title, its body when given, and `linked`, its properties with links as ids. */
export const createFields = (input: Pick<ItemInput, "title" | "body">, linked: Record<string, unknown>): Record<string, unknown> => ({
  title: input.title,
  ...(input.body === undefined ? {} : { body: input.body }),
  ...linked,
});
