import type { LenientProperty } from "@wombat/shared/items";

type Rank = number | string;

const handleParts = (handle: string): { prefix: string; number: number } => {
  const match = /^(.*)-(\d+)$/.exec(handle);
  return match === null ? { prefix: handle, number: Number.NaN } : { prefix: match[1] ?? "", number: Number(match[2]) };
};

const byCodeUnit = (a: Rank, b: Rank): number => (a < b ? -1 : a > b ? 1 : 0);

/** Text as a person reads it: case-insensitive, numbers by value (item 2 before item 10); code-unit order breaks ties. */
export const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || byCodeUnit(a, b);

/** Handles by prefix, then by number (BL-2 before BL-10); a null handle after every handle. */
export const compareHandles = (a: string | null, b: string | null): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const [x, y] = [handleParts(a), handleParts(b)];
  if (x.prefix !== y.prefix) return byCodeUnit(x.prefix, y.prefix);
  if (Number.isNaN(x.number) || Number.isNaN(y.number)) return Number.isNaN(x.number) === Number.isNaN(y.number) ? byCodeUnit(a, b) : Number.isNaN(x.number) ? 1 : -1;
  return x.number - y.number;
};

const linkHandle = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const handle: unknown = (value as Record<string, unknown>)["handle"];
  return typeof handle === "string" ? handle : undefined;
};

/**
 * What a value sorts by: a select's option index, a number, a date or text string, a link's handle. Undefined when the
 * value is missing or doesn't fit the property's type (an invalid item's value, an option that isn't listed).
 */
export const valueRank = (property: LenientProperty | undefined, value: unknown): Rank | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  switch (property?.type) {
    case "select": {
      const at = typeof value === "string" ? property.options.indexOf(value) : -1;
      return at < 0 ? undefined : at;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "date":
    case "text":
      return typeof value === "string" ? value : undefined;
    case "link":
      return linkHandle(value);
    default:
      return undefined;
  }
};

/** Two values of `property` in ascending order; a value without a rank (`valueRank`) after every value with one. */
export const compareValues = (property: LenientProperty | undefined, a: unknown, b: unknown): number => {
  const [x, y] = [valueRank(property, a), valueRank(property, b)];
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
  switch (property?.type) {
    case "link":
      return compareHandles(String(x), String(y));
    case "text":
      return compareText(String(x), String(y));
    default:
      return byCodeUnit(x, y);
  }
};

/** Whether a value equals a view filter's value: a link by its handle or id, anything else as text on both sides. */
export const matchesFilter = (value: unknown, want: string | number | boolean): boolean => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value) === String(want);
  if (typeof value !== "object" || value === null) return false;
  const { id, handle } = value as Record<string, unknown>;
  return (typeof handle === "string" && handle === String(want)) || (typeof id === "string" && id === String(want));
};

/** A value as text; empty for a missing value, the handle for a link ("missing item" when its target is gone). */
export const displayValue = (property: LenientProperty | undefined, value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (property?.type === "link" && typeof value === "object") return linkHandle(value) ?? "missing item";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};
