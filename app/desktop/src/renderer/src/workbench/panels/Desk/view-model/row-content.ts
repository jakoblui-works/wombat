import type { ItemSummary } from "@wombat/shared/items";

import type { SidebarView } from "./view-model.ts";

/** What a rich row shows in its title's place: its line (undefined: the title). */
export type RowContent = { line: string | undefined };

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
 * What an item's row shows in its title's place: nothing (undefined) unless the view's rows are rich (`richRows`); else
 * the item's excerpt as its line when it repeats the title.
 */
export const rowContent = (item: ItemSummary, view: SidebarView): RowContent | undefined => {
  if (!richRows(view)) return undefined;
  const { excerpt, title } = item;
  return { line: excerpt !== null && title !== null && repeatsTitle(title, excerpt) ? excerpt : undefined };
};

const NOTHING_SHOWN: RowContent = { line: undefined };

/** What a row shows of `content`: nothing unless it wraps. */
export const shownContent = (wraps: boolean, content: RowContent | undefined): RowContent =>
  !wraps || content === undefined ? NOTHING_SHOWN : content;
