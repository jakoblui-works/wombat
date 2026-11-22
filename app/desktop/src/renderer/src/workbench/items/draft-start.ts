import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { type FieldValue, fieldValue } from "./field-input.ts";
import { heldValue } from "./values.ts";

/**
 * A draft's starting changes from its context (`viewContext`): each value as its property holds it (`heldValue`; a
 * link's against `targets`, its binder's items), then as the form edits it, empty ones left out.
 */
export const draftStart = (
  context: Readonly<Record<string, unknown>>,
  properties: Readonly<Record<string, LenientProperty>>,
  targets: (binderId: string) => readonly ItemSummary[] | undefined,
): Record<string, FieldValue> =>
  Object.fromEntries(
    Object.entries(context).flatMap(([field, value]) => {
      const property = properties[field];
      const start = fieldValue(heldValue(property, value, property?.type === "link" ? targets(property.to) : undefined));
      return start === null ? [] : [[field, start]];
    }),
  );
