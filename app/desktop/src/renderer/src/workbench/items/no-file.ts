import type { Item } from "@wombat/shared/items";

/** What a draft edits: an item with no file, no handle and no values. */
export const NO_FILE: Item = { id: null, handle: null, aliases: [], title: "", body: "", properties: {}, path: "", version: "", excerpt: null, binder: "", problems: [] };
