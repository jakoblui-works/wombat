import type { ItemSummary, LenientProperty } from "@wombat/shared/items";

import { displayValue, numberOfText, proposedLink } from "../../Desk/view-model/values.ts";

type Fields = Readonly<Record<string, unknown>>;

/**
 * A field's value as text (`displayValue`); a link held as a bare id, as a proposal holds it, as the link items hold
 * (`proposedLink`) among `targetsOf` its property's binder, so its target's handle (`MISSING_ITEM` when none), never its id.
 */
export const valueText = (value: unknown, property: LenientProperty | undefined, targetsOf: (binderId: string) => readonly ItemSummary[]): string =>
  displayValue(property, property?.type === "link" && typeof value === "string" ? proposedLink(value, targetsOf(property.to)) : value);

/** A value as its text box holds it. */
export const inputText = (value: unknown): string => displayValue(undefined, value);

/**
 * What a property's typed text proposes: nothing (null) for an empty box, a number for a number property's text that
 * is one (`numberOfText`), else the text as typed (`0.`, ` 5`), which the service then refuses at the field.
 */
export const typedValue = (text: string, property: LenientProperty | undefined): unknown => {
  if (text === "") return null;
  return property?.type === "number" ? (numberOfText(text) ?? text) : text;
};

export const withField = (fields: Fields, name: string, value: unknown): Record<string, unknown> => ({ ...fields, [name]: value });

export const withoutField = (fields: Fields, name: string): Record<string, unknown> => Object.fromEntries(Object.entries(fields).filter(([key]) => key !== name));
