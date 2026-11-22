import { z } from "zod";

import type { ItemSummary } from "@wombat/shared/items";
import { lastPathPart } from "../../../lib/path.ts";

/** An item that exists in a binder, by its id. */
export const SavedItemParams = z.object({ binderId: z.string(), itemId: z.string() });
export type SavedItemParams = z.infer<typeof SavedItemParams>;

/** The params of item `item`'s tab, opened from its binder. */
export const itemTabParams = (item: Pick<ItemSummary, "binder"> & { id: string }): SavedItemParams => ({ binderId: item.binder, itemId: item.id });

/** Whether an item tab's `params` show item `itemId`, whichever binder the tab was opened from. */
export const showsItem = (params: unknown, itemId: string): boolean => {
  const saved = SavedItemParams.safeParse(params);
  return saved.success && saved.data.itemId === itemId;
};

/** An item not written yet: `draft` tells one new item's tab from another's; `context` holds the values it starts with. */
export const DraftItemParams = z.object({ binderId: z.string(), draft: z.string(), context: z.record(z.string(), z.unknown()) });
export type DraftItemParams = z.infer<typeof DraftItemParams>;

export const ItemParams = z.union([SavedItemParams, DraftItemParams]);
export type ItemParams = z.infer<typeof ItemParams>;

/** A tab is saved with the layout and restored unless it holds a draft. */
export const itemTabSaved = (params: unknown): boolean => !DraftItemParams.safeParse(params).success;

/** The item panel's id: its registration and every tab opened on it. */
export const ITEM_PANEL = "item";

/** The tab's title until its panel has read the item. */
export const ITEM_TITLE = "Item";

/** A draft's tab title until it is saved. */
export const NEW_ITEM_TITLE = "New item";

/** The item's title, else its file's name. */
export const itemName = ({ title, path }: Pick<ItemSummary, "title" | "path">): string => title ?? lastPathPart(path);

/** The item's handle and title; without a handle, its name. */
export const itemTitle = (item: Pick<ItemSummary, "handle" | "title" | "path">): string => (item.handle === null ? itemName(item) : [item.handle, item.title].filter((part) => part !== null).join(" "));
