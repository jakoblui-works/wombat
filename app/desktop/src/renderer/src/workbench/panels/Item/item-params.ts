// The item tab's params and title, pure (the registry, openItem and the panel read them).
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

/** The item's handle and title; the file's name for what its file doesn't give. */
export const itemTitle = ({ handle, title, path }: Pick<ItemSummary, "handle" | "title" | "path">): string =>
  [handle, title ?? (handle === null ? lastPathPart(path) : undefined)].filter((part) => part !== null && part !== undefined).join(" ");
