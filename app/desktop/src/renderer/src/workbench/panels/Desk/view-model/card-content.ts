import type { ItemSummary, LenientView } from "@wombat/shared/items";

import { displayValue } from "./values.ts";
import type { Properties } from "./view-model.ts";

export type CardContent = { chips: { name: string; text: string }[]; excerpt: string | undefined };

/** The property a view lays its items out by: a list's group, a board's column, a tree's parent link. */
const laidOutBy = (view: LenientView): string | undefined => (view.kind === "list" ? view.group : view.kind === "board" ? view.column : view.parent);

const folded = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Whether `excerpt` starts with `title` (a trailing "…" dropped from the title, whitespace folded in both). */
export const repeatsTitle = (title: string, excerpt: string): boolean => {
  const head = folded(folded(title).replace(/…$/, ""));
  return head !== "" && folded(excerpt).startsWith(head);
};

/**
 * What an item's card shows: a chip per property in the view's `show`, in order, or else per property with a value but
 * the one the view is laid out by; and the item's excerpt unless the view hides it or it repeats the title.
 */
export const cardContent = (item: ItemSummary, view: LenientView, properties: Properties): CardContent => {
  const by = laidOutBy(view);
  const names = view.show ?? Object.keys(properties).filter((name) => name !== by);
  const chips = names.flatMap((name) => {
    const text = displayValue(properties[name], item.properties[name]);
    return text === "" ? [] : [{ name, text }];
  });
  const { excerpt, title } = item;
  const shown = view.excerpt !== false && excerpt !== null && !(title !== null && repeatsTitle(title, excerpt));
  return { chips, excerpt: shown ? excerpt : undefined };
};
