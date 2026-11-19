import type { LenientProperty } from "@wombat/shared/items";

import { linkValue } from "../../Desk/view-model/values.ts";

type Fields = Readonly<Record<string, unknown>>;

/** The text a link shows for a target the items list doesn't hold (deleted, or in a binder not read). */
export const UNKNOWN_ITEM = "an item not found";

/**
 * A field's value as text: a link as its target's handle (`handleOf` answers a bare id's, as a proposal holds it),
 * never its id; nothing for an empty value; a list joined.
 */
export const valueText = (value: unknown, property: LenientProperty | undefined, handleOf: (id: string) => string | undefined): string => {
  const link = linkValue(value);
  if (link !== undefined) return link.handle ?? UNKNOWN_ITEM;
  if (property?.type === "link" && typeof value === "string") return handleOf(value) ?? UNKNOWN_ITEM;
  return inputText(value);
};

/** A value as its text box holds it, and as its row shows it when it isn't a link. */
export const inputText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
};

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
