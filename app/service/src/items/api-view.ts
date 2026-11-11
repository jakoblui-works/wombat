// The items as the HTTP API shapes them for the app: link values with handles, structures as listings.
import type { LoadedItem, LoadedStructure } from "./catalog.ts";
import { setOwn } from "./validate.ts";

/** Each item's current handle by id, for the link values. */
export const handlesById = (items: LoadedItem[]) =>
  new Map(items.flatMap((item) => (item.id === null ? [] : [[item.id, item.handle] as const])));

/** An item as the API sends it: link values become `{ id, handle }`; the catalog holds the target's raw id. */
export const withLinks = (item: LoadedItem, structures: LoadedStructure[], handles: Map<string, string | null>) => {
  const { structure: structureId, ...rest } = item;
  const settings = structures.find((structure) => structure.id === structureId)?.settings;
  if (!settings) return rest;
  const properties = { ...rest.properties };
  for (const [name, property] of Object.entries(settings.properties)) {
    const value = properties[name];
    if (property.type === "link" && typeof value === "string") {
      setOwn(properties, name, { id: value, handle: handles.get(value) ?? null });
    }
  }
  return { ...rest, properties };
};

export const summarize = (structure: LoadedStructure, items: LoadedItem[]) => {
  const own = items.filter((item) => item.structure === structure.id);
  const listing = {
    path: structure.path,
    itemCount: structure.id === null ? 0 : own.length,
    invalidCount: structure.id === null ? 0 : own.filter((item) => item.problems.length > 0).length,
    problems: structure.problems,
  };
  if (structure.id === null) return { id: null, ...listing };
  const { id, settings } = structure;
  const { name, prefix, access, naming, instructions, properties, views } = settings;
  return { id, name, prefix, access, naming, instructions, properties, views, ...listing };
};
