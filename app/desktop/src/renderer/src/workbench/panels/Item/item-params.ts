import { z } from "zod";

import type { ItemSummary } from "@wombat/shared/items";
import { lastPathPart } from "../../../lib/path.ts";

/** An item that exists in a binder, by its id. */
export const SavedItemParams = z.object({ binderId: z.string(), itemId: z.string() });
export type SavedItemParams = z.infer<typeof SavedItemParams>;

export const ItemParams = SavedItemParams;
export type ItemParams = z.infer<typeof ItemParams>;

/** The item panel's id: its registration and every tab opened on it. */
export const ITEM_PANEL = "item";

/** The tab's title until its panel has read the item. */
export const ITEM_TITLE = "Item";

/** The item's title, else its file's name. */
export const itemName = ({ title, path }: Pick<ItemSummary, "title" | "path">): string => title ?? lastPathPart(path);

/** The item's handle and title; without a handle, its name. */
export const itemTitle = (item: Pick<ItemSummary, "handle" | "title" | "path">): string => (item.handle === null ? itemName(item) : [item.handle, item.title].filter((part) => part !== null).join(" "));
