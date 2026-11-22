import type { ItemSummary, LenientProperty, LinkValue } from "@wombat/shared/items";

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

/** A link's value as the API sends it; undefined for anything else (an invalid item's raw value). */
export const linkValue = (value: unknown): LinkValue | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, handle } = value as Record<string, unknown>;
  return typeof id === "string" && (typeof handle === "string" || handle === null) ? { id, handle } : undefined;
};

/** A link a proposal holds as the bare id `id`, as items hold it: its target among `targets` (the items of the binder it links to), its handle null when none is that item. */
export const proposedLink = (id: string, targets: readonly ItemSummary[]): LinkValue => ({ id, handle: targets.find((target) => target.id === id)?.handle ?? null });

const linkHandle = (value: unknown): string | undefined => linkValue(value)?.handle ?? undefined;

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

/** A view filter's value as written. */
type Written = string | number | boolean;

/** Whether a value written in a view's settings names this item: by its handle or by its id. */
const namesItem = (want: Written, item: { id: string | null; handle: string | null }): boolean => item.handle === String(want) || item.id === String(want);

/** Whether a value equals a view filter's value: a link by its handle or id (`namesItem`), anything else as text on both sides. */
export const matchesFilter = (value: unknown, want: Written): boolean => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value) === String(want);
  const link = linkValue(value);
  return link !== undefined && namesItem(want, link);
};

/**
 * A value given for `property` as an item holds it. A value written in a view's settings (a filter's) names it: a link's
 * as the item it names among `targets`, the link's binder's items (`namesItem`; as written while none does), a number's
 * text as the number, any other type's as text. Any other value (an item's own, a link) is returned as it is.
 */
export const heldValue = (property: LenientProperty | undefined, value: unknown, targets: readonly ItemSummary[] | undefined): unknown => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return value;
  switch (property?.type) {
    case "link": {
      const target = targets?.find((item) => item.id !== null && namesItem(value, item));
      return target === undefined || target.id === null ? value : ({ id: target.id, handle: target.handle } satisfies LinkValue);
    }
    case "number": {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      return typeof number === "number" && Number.isFinite(number) ? number : value;
    }
    case "select":
    case "text":
    case "date":
      return String(value);
    default:
      return value;
  }
};

/** The binders `properties`' links name, each once. */
export const linkedBinders = (properties: Readonly<Record<string, LenientProperty>>): string[] => [
  ...new Set(Object.values(properties).flatMap((property) => (property.type === "link" ? [property.to] : []))),
];

/**
 * Typed text as a number: a plain decimal (an optional minus, digits, optionally a point and digits) is that number;
 * empty text is null (the value is cleared); anything else is undefined, never a number made by dropping characters.
 */
export const numberOfText = (text: string): number | null | undefined => (text === "" ? null : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined);

/** Whether text typed into a number field is made only of what a number is written with; a box takes no other keystroke. */
export const typesNumber = (typed: string): boolean => /^[0-9.-]*$/.test(typed);

/** A property may be emptied unless the binder requires it. */
export const clearable = (property: LenientProperty): boolean => !("required" in property && property.required === true);

/** What a link shows when its target is gone. */
export const MISSING_ITEM = "missing item";

/** A value as text; empty for a missing value, the handle for a link whatever the property (`MISSING_ITEM` when its target is gone). */
export const displayValue = (property: LenientProperty | undefined, value: unknown): string => {
  if (value === undefined || value === null) return "";
  const link = linkValue(value);
  if (link !== undefined) return link.handle ?? MISSING_ITEM;
  if (property?.type === "link" && typeof value === "object") return MISSING_ITEM;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};
