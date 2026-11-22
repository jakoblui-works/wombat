import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { useBinderItems } from "../../data/hooks.ts";
import { usable } from "./reads.ts";
import { linkedBinders } from "./values.ts";

/** The items a link to binder `binderId` may name. */
export type ItemsOf = (binderId: string) => readonly ItemSummary[];

/** A linked binder's items by its id; undefined while they can't be shown (`usable`). */
export type Listed = (binderId: string) => readonly ItemSummary[] | undefined;

/** The items of the binders `properties` link to (`linkedBinders`); `pending` while one hasn't been read yet. */
export const useLinkLists = (properties: Readonly<Record<string, LenientProperty>>): { listed: Listed; itemsOf: ItemsOf; pending: boolean } => {
  const listIds = linkedBinders(properties);
  const lists = useBinderItems(listIds);
  const listed: Listed = (id) => {
    const list = lists[listIds.indexOf(id)];
    return usable({ data: list?.data?.items, error: list?.error });
  };
  return { listed, itemsOf: (id) => listed(id) ?? [], pending: lists.some((list) => list.isPending) };
};

/** What a binder's links may name, by binder: its own `items` (as the view shows them) for its own id, else the linked binder's as read so far. */
export const useItemsOf = (binderId: string, properties: Readonly<Record<string, LenientProperty>>, items: readonly ItemSummary[]): ItemsOf => {
  const { itemsOf } = useLinkLists(properties);
  return (id) => (id === binderId ? items : itemsOf(id));
};
