import type { LenientProperty, LinkValue, Problem } from "@wombat/shared/items";

type Fields = Readonly<Record<string, unknown>>;

/** The text a link shows for a target the items list doesn't hold (deleted, or in a binder not read). */
export const UNKNOWN_ITEM = "an item not found";

const isLinkValue = (value: unknown): value is LinkValue =>
  typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && "handle" in value;

/**
 * A field's value as text: a link as its target's handle (`handleOf` answers a bare id's, as a proposal holds it),
 * never its id; nothing for an empty value; a list joined.
 */
export const valueText = (value: unknown, property: LenientProperty | undefined, handleOf: (id: string) => string | undefined): string => {
  if (isLinkValue(value)) return value.handle ?? UNKNOWN_ITEM;
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

/** Problems split by the row they belong to: `at` for a field among `names`, `rest` for the others. */
export const problemsByField = (problems: readonly Problem[], names: readonly string[]): { at: ReadonlyMap<string, Problem[]>; rest: Problem[] } => {
  const at = new Map<string, Problem[]>();
  const rest: Problem[] = [];
  for (const problem of problems) {
    if (problem.field === undefined || !names.includes(problem.field)) {
      rest.push(problem);
      continue;
    }
    at.set(problem.field, [...(at.get(problem.field) ?? []), problem]);
  }
  return { at, rest };
};
