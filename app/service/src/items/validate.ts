// An item's frontmatter checked against its structure's settings: only `id`, `handle`, `aliases` and the declared
// properties, each value of its property's type. Links are checked through `links`, which knows every item.
import type { Problem, Property, StructureSettings } from "@wombat/shared/items";

/** The item's own keys; every other frontmatter key must be a property. */
export const OWN_KEYS = new Set(["id", "handle", "aliases"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const HANDLE = /^([A-Z][A-Z0-9]{0,9})-([1-9][0-9]*)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The prefix and number of a handle like `BUG-14`; undefined for anything else. */
export const parseHandle = (value: unknown): { prefix: string; number: number } | undefined => {
  const match = typeof value === "string" ? HANDLE.exec(value) : null;
  if (match === null) return undefined;
  return { prefix: match[1] ?? "", number: Number(match[2]) };
};

/** What a link value names, as `links` finds it. */
export type LinkTarget =
  /** The raw id of an item in the target structure. */
  | { kind: "id" }
  /** A handle or alias of exactly one item in the target structure, which has an id: rewrite it to that id. */
  | { kind: "handle"; id: string }
  /** No item of the target structure; `reason` says what the value names instead. */
  | { kind: "none"; reason: string };

export type LinkLookup = (to: string, value: string) => LinkTarget;

const isRealDate = (value: string) => {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** Problems of one property value (present, not null). */
const checkValue = (name: string, property: Property, value: unknown, links: LinkLookup, rewrites: Map<string, string>): Problem[] => {
  const problem = (message: string): Problem[] => [{ field: name, message: `${name}: ${message}` }];
  switch (property.type) {
    case "select":
      if (typeof value === "string" && property.options.includes(value)) return [];
      return problem(`${JSON.stringify(value)} is not an option; use one of ${property.options.join(", ")}`);
    case "text":
      if (typeof value === "string") return [];
      return problem(
        typeof value === "number" || typeof value === "boolean"
          ? `takes text; put the value in quotes, like ${name}: "${String(value)}"`
          : `takes text, like ${name}: Seen on staging`,
      );
    case "date":
      return typeof value === "string" && isRealDate(value) ? [] : problem(`takes a date as YYYY-MM-DD, like ${name}: 2026-11-02`);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? [] : problem(`takes a number, like ${name}: 3`);
    case "link": {
      if (typeof value !== "string") return problem(`takes the handle of an item in ${property.to}, like ${name}: ${property.to.toUpperCase()}-1`);
      const target = links(property.to, value);
      if (target.kind === "id") return [];
      if (target.kind === "handle") {
        rewrites.set(name, target.id);
        return [];
      }
      return problem(`${value} ${target.reason}; link an item of ${property.to} by its handle`);
    }
  }
};

export type Validated = {
  problems: Problem[];
  /** Property values as the file holds them; null values (an empty `key:`) are left out. */
  properties: Record<string, unknown>;
  /** Link properties whose value is a handle or alias, to rewrite to this id: links store ids, which never change. */
  rewrites: Map<string, string>;
};

/** Checks the frontmatter's keys and property values; `id`, `handle` and `aliases` are the caller's. */
export const validateProperties = (settings: StructureSettings, data: Record<string, unknown>, links: LinkLookup): Validated => {
  const problems: Problem[] = [];
  const properties: Record<string, unknown> = {};
  const rewrites = new Map<string, string>();
  const declared = Object.keys(settings.properties);
  for (const [key, value] of Object.entries(data)) {
    if (OWN_KEYS.has(key)) continue;
    const property = settings.properties[key];
    if (property === undefined) {
      const known = declared.length === 0 ? "it has no properties" : `its properties are ${declared.join(", ")}`;
      problems.push({ field: key, message: `${key}: not a property of ${settings.name} (${known}); fix the name or remove the line` });
      if (value !== null) properties[key] = value;
      continue;
    }
    if (value === null) continue;
    properties[key] = value;
    problems.push(...checkValue(key, property, value, links, rewrites));
  }
  for (const [name, property] of Object.entries(settings.properties)) {
    if (!property.required || (data[name] !== undefined && data[name] !== null)) continue;
    const example = property.type === "select" ? `, one of ${property.options.join(", ")}` : "";
    problems.push({ field: name, message: `${name}: required; add a value${example}` });
  }
  return { problems, properties, rewrites };
};

/** Problems of the item's own keys, apart from duplicates across files. */
export const validateOwnKeys = (settings: StructureSettings, data: Record<string, unknown>): Problem[] => {
  const problems: Problem[] = [];
  const { id, handle, aliases } = data;
  if (id !== undefined && !isUuid(id)) {
    problems.push({ field: "id", message: "id: not a UUID; the service sets it, so remove the line to get a new one" });
  }
  if (handle !== undefined) {
    const parsed = parseHandle(handle);
    if (parsed === undefined) {
      problems.push({ field: "handle", message: `handle: ${JSON.stringify(handle)} is not a handle like ${settings.prefix}-1; remove the line to get a new one` });
    } else if (parsed.prefix !== settings.prefix) {
      problems.push({
        field: "handle",
        message: `handle: ${parsed.prefix}-${parsed.number} doesn't start with this structure's prefix ${settings.prefix}; keep it in aliases and remove the handle line to get a new one`,
      });
    }
  }
  if (aliases !== undefined && (!Array.isArray(aliases) || aliases.some((alias) => parseHandle(alias) === undefined))) {
    problems.push({ field: "aliases", message: `aliases: takes a list of old handles, like aliases: [${settings.prefix}-3]` });
  }
  return problems;
};
