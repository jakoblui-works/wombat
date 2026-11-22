import type { ItemSummary } from "@wombat/shared/items";

import type { SidebarView } from "./view-model.ts";

/** Text as read: emphasis and code markers dropped, whitespace folded. */
const plain = (text: string): string => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** Whether `excerpt` starts with `title`, both as read (`plain`), a trailing "…" dropped from the title. */
export const repeatsTitle = (title: string, excerpt: string): boolean => {
  const head = plain(plain(title).replace(/…$/, ""));
  return head !== "" && plain(excerpt).startsWith(head);
};

/**
 * Whether a view's rows are rich (a paragraph in the title's place): a list's unless it sets `excerpt: false`; a tree's
 * never.
 */
export const richRows = (view: SidebarView): boolean => view.kind === "list" && view.excerpt !== false;

/**
 * What an item's row shows in its title's place: nothing (undefined) unless the view's rows are rich (`richRows`) and
 * the item's excerpt repeats its title; then the excerpt.
 */
export const rowContent = (item: ItemSummary, view: SidebarView): string | undefined => {
  if (!richRows(view)) return undefined;
  const { excerpt, title } = item;
  return excerpt !== null && title !== null && repeatsTitle(title, excerpt) ? excerpt : undefined;
};
