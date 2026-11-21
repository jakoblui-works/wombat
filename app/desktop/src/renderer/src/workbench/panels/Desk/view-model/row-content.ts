import type { ItemSummary } from "@wombat/shared/items";

import { displayValue } from "./values.ts";
import { laidOutBy, type Properties, type SidebarView } from "./view-model.ts";

/**
 * What a rich row shows: its line in the title's place (undefined: the title), its excerpt under it (undefined: none)
 * and its values as text, in the binder's order.
 */
export type RowContent = { line: string | undefined; excerpt: string | undefined; values: string[] };

/** Text as read: emphasis and code markers dropped, whitespace folded. */
const plain = (text: string): string => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** Whether `excerpt` starts with `title`, both as read (`plain`), a trailing "…" dropped from the title. */
export const repeatsTitle = (title: string, excerpt: string): boolean => {
  const head = plain(plain(title).replace(/…$/, ""));
  return head !== "" && plain(excerpt).startsWith(head);
};

/** Whether a view's rows are rich (title, excerpt, values): a list's unless it sets `excerpt: false`; a tree's never. */
export const richRows = (view: SidebarView): boolean => view.kind === "list" && view.excerpt !== false;

/**
 * What an item's row shows besides its title: nothing (undefined) unless the view's rows are rich (`richRows`); else a
 * value per property with one but the property the view is laid out by (`laidOutBy`), and the item's excerpt: in the
 * title's place when it repeats the title, else under it.
 */
export const rowContent = (item: ItemSummary, view: SidebarView, properties: Properties): RowContent | undefined => {
  if (!richRows(view)) return undefined;
  const by = laidOutBy(view);
  const values = Object.keys(properties)
    .filter((name) => name !== by)
    .map((name) => displayValue(properties[name], item.properties[name]))
    .filter((text) => text !== "");
  const { excerpt, title } = item;
  if (excerpt === null) return { line: undefined, excerpt: undefined, values };
  if (title !== null && repeatsTitle(title, excerpt)) return { line: excerpt, excerpt: undefined, values };
  return { line: undefined, excerpt, values };
};

/**
 * What a row draws: its line in the title's place (undefined: the title), its excerpt and its values as one line under
 * it, each undefined when not shown.
 */
export type Shown = { line: string | undefined; excerpt: string | undefined; values: string | undefined };

export const NOTHING_SHOWN: Shown = { line: undefined, excerpt: undefined, values: undefined };

/** What a row shows of `content`: nothing unless it wraps; its value line only when it holds a value. */
export const shownContent = (wraps: boolean, content: RowContent | undefined): Shown =>
  !wraps || content === undefined
    ? NOTHING_SHOWN
    : { line: content.line, excerpt: content.excerpt, values: content.values.length === 0 ? undefined : content.values.join(" · ") };
