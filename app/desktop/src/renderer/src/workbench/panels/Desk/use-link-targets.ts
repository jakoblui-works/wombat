import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { useBinderItems } from "../../../data/hooks.ts";
import { linkedBinders } from "./view-model/values.ts";

/** Every item a link field of a binder with `properties` may name: `items` (its own) and its linked binders' as read so far. */
export const useLinkTargets = (binderId: string, properties: Readonly<Record<string, LenientProperty>>, items: readonly ItemSummary[]): ItemSummary[] => {
  const others = linkedBinders(properties).filter((id) => id !== binderId);
  const lists = useBinderItems(others);
  return [...items, ...lists.flatMap((list) => list.data?.items ?? [])];
};
