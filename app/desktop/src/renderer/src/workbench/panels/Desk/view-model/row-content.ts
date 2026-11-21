import type { ItemSummary } from "@wombat/shared/items";

import { displayValue } from "./values.ts";
import { laidOutBy, type Properties, type SidebarView } from "./view-model.ts";

/** What a rich row shows under its title: its excerpt (undefined: none) and its values as text, in the binder's order. */
export type RowContent = { excerpt: string | undefined; values: string[] };

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
 * What an item's row shows under its title: nothing (undefined) unless the view's rows are rich (`richRows`); else a
 * value per property with one but the property the view is laid out by (`laidOutBy`), and the item's excerpt unless
 * it has none or it repeats the title.
 */
export const rowContent = (item: ItemSummary, view: SidebarView, properties: Properties): RowContent | undefined => {
  if (!richRows(view)) return undefined;
  const by = laidOutBy(view);
  const values = Object.keys(properties)
    .filter((name) => name !== by)
    .map((name) => displayValue(properties[name], item.properties[name]))
    .filter((text) => text !== "");
  const { excerpt, title } = item;
  const shown = excerpt !== null && !(title !== null && repeatsTitle(title, excerpt));
  return { excerpt: shown ? excerpt : undefined, values };
};

/** What a row draws under its title: its excerpt and its values as one line, each undefined when not shown. */
export type Shown = { excerpt: string | undefined; values: string | undefined };

export const NOTHING_SHOWN: Shown = { excerpt: undefined, values: undefined };

/** What a row shows of `content`: nothing unless it wraps; its value line only when it holds a value. */
export const shownContent = (wraps: boolean, content: RowContent | undefined): Shown =>
  !wraps || content === undefined ? NOTHING_SHOWN : { excerpt: content.excerpt, values: content.values.length === 0 ? undefined : content.values.join(" · ") };
