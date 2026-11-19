import type { LenientProperty } from "@wombat/shared/items";

import { displayValue, MISSING_ITEM } from "../../Desk/view-model/values.ts";

type Fields = Readonly<Record<string, unknown>>;

/**
 * A field's value as text (`displayValue`), and a link held as a bare id, as a proposal holds it, as its target's
 * handle from `handleOf` (`MISSING_ITEM` when the items lists don't hold it), never its id.
 */
export const valueText = (value: unknown, property: LenientProperty | undefined, handleOf: (id: string) => string | undefined): string =>
  property?.type === "link" && typeof value === "string" ? (handleOf(value) ?? MISSING_ITEM) : displayValue(property, value);

/** A value as its text box holds it. */
export const inputText = (value: unknown): string => displayValue(undefined, value);

/**
 * What a property's typed text proposes: nothing (null) for an empty box, a number for a number property's text that
 * reads back the same as that number, else the text as typed (`0.`, `05`, ` 5`), so the box keeps what was typed and
 * the service checks it.
 */
export const typedValue = (text: string, property: LenientProperty | undefined): unknown => {
  if (text === "") return null;
  if (property?.type === "number" && Number.isFinite(Number(text)) && String(Number(text)) === text) return Number(text);
  return text;
};

export const withField = (fields: Fields, name: string, value: unknown): Record<string, unknown> => ({ ...fields, [name]: value });

export const withoutField = (fields: Fields, name: string): Record<string, unknown> => Object.fromEntries(Object.entries(fields).filter(([key]) => key !== name));
